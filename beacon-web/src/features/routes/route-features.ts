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
