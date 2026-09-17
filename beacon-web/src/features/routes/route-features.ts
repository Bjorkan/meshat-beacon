// Pure GeoJSON projection for planned routes (no React/MapLibre): legs become
// line features with per-leg SNR colors, waypoints become point features.
// Tested without WebGL via routesToFeatures below.
import type { FeatureCollection, LineString, Point } from 'geojson';
import type { PlannedRoute, PlannedRouteLeg, PlannedRouteNode } from '../../types/api';
import { traceLegColor, type TraceSnrPalette } from '../traces/trace-path';

export interface PlannedLegProps {
  routeIndex: number;
  active: boolean;
  snrColor: string;
  label: string;
}

export interface PlannedNodeProps {
  routeIndex: number;
  active: boolean;
  label: string;
  title: string;
  endpoint: 'start' | 'end' | 'mid';
}

function nodeLabel(n: { name?: string; publicKey: string }): string {
  return n.name ?? n.publicKey.slice(0, 6).toUpperCase();
}

// MeshCore route export: the planned route as comma-separated 3-byte route
// hashes (first 3 bytes / 6 hex chars of each repeater's full public key),
// e.g. "030680,ab6b92,73f8a9". Lowercase hex, no spaces.
//
// A MeshCore packet carries at most a 64-byte path payload, so a 3-byte-hash
// route holds at most 21 hashes (21*3 = 63). The limit applies to exported
// 3-byte IDs (legs.length + 1 with the requested start+end semantics), not
// just the planner's leg count.
//
// The canonical ordered repeater list is built leg-by-leg: the first leg's
// `from` (the chosen start repeater — never prepend anything before it),
// then every leg's `to` in order. Legs must form one continuous chain and
// are the source of truth, not path.nodes, so a duplicated start/target
// across nodes+legs can never produce a doubled first/last entry.
export const MESHCORE_3BYTE_MAX_HASHES = 21;

export type MeshCoreRouteExport =
  { ok: true; value: string } | { ok: false; reason: 'invalid-key' | 'too-long' | 'discontinuous' };

function normalizeFullKey(key: string): string | null {
  const hex = key.replace(/\s+/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

export function exportMeshcoreRoute(route: PlannedRoute): MeshCoreRouteExport {
  if (route.legs.length === 0) return { ok: false, reason: 'invalid-key' };
  const first = route.legs[0];
  if (first == null) return { ok: false, reason: 'invalid-key' };
  // Legs must form one continuous chain: A->B, B->C — never A->B, C->D.
  for (let i = 1; i < route.legs.length; i++) {
    const prev = normalizeFullKey(route.legs[i - 1]?.to ?? '');
    const cur = normalizeFullKey(route.legs[i]?.from ?? '');
    if (prev == null || cur == null || prev !== cur) return { ok: false, reason: 'discontinuous' };
  }
  // Canonical ordered repeater list: first leg's `from` is the chosen start
  // repeater (never prepend anything before it), then every leg's `to`.
  const orderedKeys: string[] = [first.from];
  for (const leg of route.legs) orderedKeys.push(leg.to);
  if (orderedKeys.length > MESHCORE_3BYTE_MAX_HASHES) return { ok: false, reason: 'too-long' };
  const ids: string[] = [];
  for (const key of orderedKeys) {
    const hex = normalizeFullKey(key);
    if (hex == null) return { ok: false, reason: 'invalid-key' };
    ids.push(hex.slice(0, 6));
  }
  return { ok: true, value: ids.join(',') };
}

// Legacy string-or-null wrapper. Prefer exportMeshcoreRoute for new code so
// callers can explain *why* copying is unavailable (too-long vs invalid).
export function plannedRouteToMeshcore(route: PlannedRoute): string | null {
  const res = exportMeshcoreRoute(route);
  return res.ok ? res.value : null;
}

export function routesToFeatures(
  paths: PlannedRoute[],
  activeIndex: number,
  palette: TraceSnrPalette,
): {
  lines: FeatureCollection<LineString, PlannedLegProps>;
  points: FeatureCollection<Point, PlannedNodeProps>;
  bounds: [number, number][];
} {
  const lines: FeatureCollection<LineString, PlannedLegProps>['features'] = [];
  const points: FeatureCollection<Point, PlannedNodeProps>['features'] = [];
  const bounds: [number, number][] = [];
  paths.forEach((path: PlannedRoute, routeIndex: number) => {
    const active = routeIndex === activeIndex;
    const byKey = new Map<string, PlannedRouteNode>(
      path.nodes.map((n: PlannedRouteNode) => [n.publicKey.toLowerCase(), n]),
    );
    path.legs.forEach((leg: PlannedRouteLeg) => {
      const from = byKey.get(leg.from.toLowerCase());
      const to = byKey.get(leg.to.toLowerCase());
      if (
        !from ||
        !to ||
        from.latitude == null ||
        from.longitude == null ||
        to.latitude == null ||
        to.longitude == null
      )
        return;
      const snrColor = traceLegColor(leg.unmeasured ? null : (leg.snr ?? null), palette);
      const label =
        `${nodeLabel(from)} → ${nodeLabel(to)}` +
        (leg.snr != null && !leg.unmeasured ? ` · ${leg.snr.toFixed(2)} dB` : '');
      lines.push({
        type: 'Feature',
        properties: { routeIndex, active, snrColor, label },
        geometry: {
          type: 'LineString',
          coordinates: [
            [from.longitude, from.latitude],
            [to.longitude, to.latitude],
          ],
        },
      });
      bounds.push([from.longitude, from.latitude]);
    });
    const last = path.nodes[path.nodes.length - 1];
    if (last && last.latitude != null && last.longitude != null)
      bounds.push([last.longitude, last.latitude]);
    const seen = new Set<string>();
    path.nodes.forEach((n: PlannedRouteNode, i: number) => {
      if (n.latitude == null || n.longitude == null) return;
      const key = n.publicKey.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      points.push({
        type: 'Feature',
        properties: {
          routeIndex,
          active,
          label: nodeLabel(n),
          title: n.name ?? n.publicKey,
          endpoint: i === 0 ? 'start' : i === path.nodes.length - 1 ? 'end' : 'mid',
        },
        geometry: { type: 'Point', coordinates: [n.longitude, n.latitude] },
      });
    });
  });
  // alternatives under the best path: draw dimmed routes first so the active
  // route paints on top. Active features sort last (source order = paint
  // order for the single line layer).
  lines.sort((a, b) => Number(a.properties.active) - Number(b.properties.active));
  return {
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
    bounds,
  };
}
