import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { ResolvedHop, TracePacket } from '../../types/api';
import { SNR_STOPS } from '../../lib/signal';
import { pathWithinLoRaRange } from '../map/packet-flow';

// Trace-detaljens kartunderlag: samma verifieringsregler som Paketsökvägen (packet-path.ts),
// men byggd från TracePackets råa hopp istället för PacketDetail-observationer. Varje ritbart
// ben förses med sin uppmätta SNR så kartan kan färga det med grannsystemets SNR-skala.

export interface TracePathPoint {
  id: string;
  name?: string;
  lng: number;
  lat: number;
}

export interface TracePathLeg {
  from: TracePathPoint;
  to: TracePathPoint;
  snr: number | null; // SNR[i] hör till länken hop i-1 → hop i; saknas utan mätvärde
  ambiguous: boolean; // någon ände upplöstes tvetydigt — ritas streckad
}

export interface TracePath {
  key: string; // packetHash
  label: string; // kort hash för väljaren
  color: string;
  legs: TracePathLeg[];
  points: TracePathPoint[];
}

export interface TracePathsBlocked {
  reason: 'out-of-range' | 'unresolved';
  count: number;
}

// Samma distinkta färger som Paketsökvägen: läsbara på både mörk och ljus baskarta.
export const TRACE_PATH_COLORS: string[] = [
  '#ff6b35', // orange
  '#00b4d8', // cyan
  '#22c55e', // green
  '#e879f9', // pink
  '#eab308', // yellow
  '#3b82f6', // blue
  '#ef4444', // red
  '#a78bfa', // violet
];

// SNR → grannsystemets linjefärg: samma stops som useMapNeighbors' line-color
// (danger/warn/green) plus grannlagrets blå fallback utan mätvärde.
export function traceLegColor(snr: number | null, palette: TraceSnrPalette): string {
  if (snr == null || !Number.isFinite(snr)) return palette.noSnr;
  if (snr >= SNR_STOPS.green) return palette.green;
  if (snr >= SNR_STOPS.warn) return palette.warn;
  return palette.danger;
}

export interface TraceSnrPalette {
  danger: string;
  warn: string;
  green: string;
  noSnr: string;
}

export const TRACE_SNR_FALLBACK: TraceSnrPalette = {
  danger: '#EF4444',
  warn: '#EAB308',
  green: '#22C55E',
  noSnr: '#3B82F6',
};

function paletteFromDocument(): TraceSnrPalette {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function')
    return TRACE_SNR_FALLBACK;
  const css = (name: string, fallback: string) => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch {
      return fallback;
    }
  };
  return {
    danger: css('--palette-danger', TRACE_SNR_FALLBACK.danger),
    warn: css('--palette-warn', TRACE_SNR_FALLBACK.warn),
    green: css('--palette-green', TRACE_SNR_FALLBACK.green),
    noSnr: TRACE_SNR_FALLBACK.noSnr,
  };
}

export function traceSnrPalette(): TraceSnrPalette {
  return paletteFromDocument();
}

function firstLocated(hop: ResolvedHop | undefined): TracePathPoint | null {
  const node = hop?.nodes.find((n) => n.latitude != null && n.longitude != null);
  if (!node) return null;
  return { id: node.id, name: node.name, lng: node.longitude!, lat: node.latitude! };
}

// Ett ben behöver två lokaliserade grannar i följd. Tvetydiga eller olokaliserade hopp bryter
// kedjan hellre än att rita en gissad linje — samma fail-closed som Paketsökvägen.
export function buildTracePaths(packets: TracePacket[]): {
  paths: TracePath[];
  blocked: TracePathsBlocked | null;
} {
  const raw: Omit<TracePath, 'color'>[] = [];
  let outOfRangeCount = 0;
  let unresolvedCount = 0;

  for (const pkt of packets) {
    const hops = pkt.rawPath ?? [];
    const resolved = pkt.resolvedRoute ?? [];
    const legs: TracePathLeg[] = [];
    const points: TracePathPoint[] = [];
    let prevPoint: TracePathPoint | null = null;
    let hadPlaceableHop = false;
    for (let i = 0; i < hops.length; i++) {
      const point = firstLocated(resolved[i]);
      const hop = resolved[i];
      const ambiguous = hop != null && hop.confidence !== 'high';
      if (point) {
        hadPlaceableHop = true;
        if (!points.some((p) => p.id === point.id)) points.push(point);
      }
      if (point && prevPoint) {
        // SNR[i] är hop i:s mätning av länken från hop i-1 (backendens neighbor-edge-semantik).
        legs.push({
          from: prevPoint,
          to: point,
          snr: hops[i]?.snr ?? null,
          ambiguous: ambiguous || prevPointAmbiguous(resolved[i - 1]),
        });
      }
      prevPoint = point ?? null;
      // Ett hopp utan koordinat bryter linjen: nästa ben börjar om från nästa lokaliserade hopp.
      if (!point) prevPoint = null;
    }
    if (legs.length === 0) {
      unresolvedCount += 1;
      continue;
    }
    if (!pathWithinLoRaRange(chainCoords(points, legs))) {
      outOfRangeCount += 1;
      continue;
    }
    void hadPlaceableHop;
    raw.push({
      key: pkt.packetHash,
      label: pkt.packetHash.slice(0, 8).toUpperCase(),
      legs,
      points,
    });
  }

  const paths = raw.map((p, i) => ({
    ...p,
    color: TRACE_PATH_COLORS[i % TRACE_PATH_COLORS.length]!,
  }));
  const blocked: TracePathsBlocked | null =
    paths.length > 0 || outOfRangeCount + unresolvedCount === 0
      ? null
      : outOfRangeCount > 0
        ? { reason: 'out-of-range', count: outOfRangeCount + unresolvedCount }
        : { reason: 'unresolved', count: unresolvedCount };
  return { paths, blocked };
}

function prevPointAmbiguous(hop: ResolvedHop | undefined): boolean {
  return hop != null && hop.confidence !== 'high';
}

// Benens ändpunkter i ritordning, utan dubbletter där benen hänger ihop.
function chainCoords(points: TracePathPoint[], legs: TracePathLeg[]): [number, number][] {
  if (legs.length === 0) return points.map((p) => [p.lng, p.lat]);
  const coords: [number, number][] = [[legs[0]!.from.lng, legs[0]!.from.lat]];
  for (const leg of legs) coords.push([leg.to.lng, leg.to.lat]);
  return coords;
}

export interface TraceLegProps {
  key: string; // packetHash — isolerar ett paket vid val
  color: string; // paketets färg (väljaren)
  snrColor: string; // benets SNR-färg (samma skala som grannlinjerna)
  snr: number | null;
  label: string; // "A → B · +3.50 dB" för popup
}

export interface TracePointProps {
  key: string;
  color: string;
  label: string;
  title: string;
  endpoint: 'start' | 'end' | 'mid';
  packetLabel: string;
}

// Ett ben per linje-feature (inte en linje per paket): då kan varje ben bära sin egen
// snrColor och streckas vid tvetydig upplösning. Punkter dubblett-rensas per paket.
export function tracePathsToFeatures(
  paths: TracePath[],
  selectedKey: string | null,
  palette: TraceSnrPalette = TRACE_SNR_FALLBACK,
): {
  lines: FeatureCollection<LineString, TraceLegProps>;
  points: FeatureCollection<Point, TracePointProps>;
  bounds: [number, number][];
} {
  const shown = selectedKey ? paths.filter((p) => p.key === selectedKey) : paths;
  const lines: Feature<LineString, TraceLegProps>[] = [];
  const points: Feature<Point, TracePointProps>[] = [];
  const bounds: [number, number][] = [];

  for (const path of shown) {
    path.legs.forEach((leg, i) => {
      const snrColor = traceLegColor(leg.snr, palette);
      const fromLabel = leg.from.name ?? leg.from.id.slice(0, 6);
      const toLabel = leg.to.name ?? leg.to.id.slice(0, 6);
      lines.push({
        type: 'Feature',
        properties: {
          key: path.key,
          color: path.color,
          snrColor,
          snr: leg.snr,
          label: `${fromLabel} → ${toLabel}${leg.snr != null ? ` · ${leg.snr.toFixed(2)} dB` : ''}${leg.ambiguous ? ' · ~' : ''}`,
          ...(leg.ambiguous ? { ambiguous: true } : {}),
          legIndex: i,
        } as TraceLegProps & { ambiguous?: boolean; legIndex: number },
        geometry: {
          type: 'LineString',
          coordinates: [
            [leg.from.lng, leg.from.lat],
            [leg.to.lng, leg.to.lat],
          ],
        },
      });
      bounds.push([leg.from.lng, leg.from.lat]);
      if (i === path.legs.length - 1) bounds.push([leg.to.lng, leg.to.lat]);
    });
    const seen = new Set<string>();
    const ordered: TracePathPoint[] = [];
    for (const leg of path.legs) {
      for (const pt of [leg.from, leg.to]) {
        if (!seen.has(pt.id)) {
          seen.add(pt.id);
          ordered.push(pt);
        }
      }
    }
    ordered.forEach((pt, i) => {
      const endpoint = i === 0 ? 'start' : i === ordered.length - 1 ? 'end' : 'mid';
      points.push({
        type: 'Feature',
        properties: {
          key: path.key,
          color: path.color,
          label: pt.name ?? pt.id.slice(0, 6),
          title: pt.name ?? pt.id,
          endpoint,
          packetLabel: path.label,
        },
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
      });
    });
  }

  return {
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
    bounds,
  };
}
