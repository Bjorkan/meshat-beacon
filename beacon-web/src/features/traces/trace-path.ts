import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { ResolvedHop, TracePacket } from '../../types/api';
import { SNR_STOPS } from '../../lib/signal';
import { pathWithinLoRaRange } from '../map/packet-flow';

// Trace-detaljens kartunderlag: samma verifieringsregler som Paketsökvägen (packet-path.ts),
// men byggd från TracePackets råa hopp istället för PacketDetail-observationer. Varje ritbart
// ben förses med sin uppmätta SNR så kartan kan färga det med grannsystemets SNR-skala.
//
// Fail-closed som Paketsökvägen: INGEN del av en trace ritas om NÅGON del är tvetydig.
// Samma spärrar som de andra kartorna: 1-byte-hashar kan aldrig verifieras (samma bar som
// Paketsökvägens MIN_VERIFIABLE_HASH_BYTES), 2-byte kräver kollisionsfrihet i hela databasen
// (ambiguousPrefix2) plus high-confidence överallt.

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
}

export interface TracePathAggregateLeg {
  from: TracePathPoint;
  to: TracePathPoint;
  snr: number | null; // medelvärde över paketens mätningar av detta ben; null utan mätvärde
  snrSpread: number; // max − min över paketens mätningar (0 vid ett paket/enighet)
  snrSamples: number; // antal paket som mätte detta ben
}

export interface TracePath {
  key: string; // packetHash
  label: string; // kort hash för väljaren
  color: string;
  legs: TracePathLeg[];
  points: TracePathPoint[];
}

export interface TracePathsBlocked {
  reason: 'short-hash' | 'ambiguous-hop' | 'out-of-range' | 'unresolved';
  // Bästa observerade hashbredd (t.ex. 1) — används i short-hash-meddelandet.
  observedHashSize: number;
  count: number;
}

// Samma verifieringsbar som Paketsökvägen (packet-path.ts): 3+ byte ritas alltid,
// 2 byte kräver noll globala kollisioner + high-confidence överallt, 1 byte ritas aldrig.
export const MIN_TRACE_HASH_BYTES = 2;

export interface TracePathOptions {
  ambiguousPrefix2?: string[] | null;
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

// Råa hashars bytelängd = den enda breddsignal trace-paket bär (hexsträng / 2).
// Ojämna/ogiltiga hashars ger null — då hoppar breddgaten över (fail-open på just
// den gaten, som Paketsökvägen; confidence/avstånd/punkt-kontroller gäller ändå).
function pktHashSize(hops: { hash: string }[]): number | null {
  let widest: number | null = null;
  for (const h of hops) {
    if (!/^[0-9a-fA-F]+$/.test(h.hash) || h.hash.length % 2 !== 0) return null;
    widest = widest == null ? h.hash.length / 2 : Math.max(widest, h.hash.length / 2);
  }
  return widest;
}

// Ett ben behöver två säkra grannar i följd (high-confidence + lokaliserade).
// Tvetydiga eller olokaliserade hopp bryter kedjan — de ritas aldrig, inte ens
// streckade. Samma fail-closed som Paketsökvägen: kort-hash-spärr, 2-byte-spärr
// mot globala kollisionsmängden, och LoRa-avståndsspärr gäller per paket.
export function buildTracePaths(
  packets: TracePacket[],
  options?: TracePathOptions,
): {
  paths: TracePath[];
  blocked: TracePathsBlocked | null;
} {
  const raw: Omit<TracePath, 'color'>[] = [];
  let shortHashCount = 0;
  let ambiguousHopCount = 0;
  let outOfRangeCount = 0;
  let unresolvedCount = 0;
  let widestObserved = 0;
  // Fail-closed: utan serverns kollisionsmängd kan vi inte bevisa att en 2-byte-rutt
  // är säker, så 2-byte-kandidater undanhålls tills fetchen löst sig.
  const ambiguousPrefix2 =
    options?.ambiguousPrefix2 == null ? null : new Set(options.ambiguousPrefix2);

  for (const pkt of packets) {
    const hops = pkt.rawPath ?? [];
    const resolved = pkt.resolvedRoute ?? [];
    // Kort-hash-spärr (samma som Paketsökvägens MIN_VERIFIABLE_HASH_BYTES): råa hashars
    // bytelängd är den enda breddsignal trace-paket bär. Under 2 byte kan ett ben aldrig
    // verifieras — hela paketet undanhålls som 'short-hash' istället för att ritas osäkert.
    const hashSize = pktHashSize(hops);
    if (hashSize != null) widestObserved = Math.max(widestObserved, hashSize);
    if (hashSize != null && hashSize < MIN_TRACE_HASH_BYTES) {
      shortHashCount += 1;
      continue;
    }
    // Full-paket-spärr (samma som Paketsökvägens 2-byte-regel): INGEN del av paketet
    // ritas om NÅGOT hopp inte är high-confidence — även om resten vore ritbart.
    // Hellre undanhållet som 'ambiguous-hop' än osäkert ritat.
    if (resolved.some((h) => h.confidence !== 'high')) {
      ambiguousHopCount += 1;
      continue;
    }
    // 2-byte-spärr (samma som Paketsökvägen): kräver dessutom kollisionsfrihet i hela
    // databasen (ambiguousPrefix2). Fail-closed medan kollisionsmängden laddar.
    if (hashSize === MIN_TRACE_HASH_BYTES) {
      const airPrefixes = hops.map((h) => h.hash.toLowerCase());
      if (ambiguousPrefix2 == null || airPrefixes.some((p) => ambiguousPrefix2.has(p))) {
        ambiguousHopCount += 1;
        continue;
      }
    }
    const legs: TracePathLeg[] = [];
    const points: TracePathPoint[] = [];
    let prevPoint: TracePathPoint | null = null;
    for (let i = 0; i < hops.length; i++) {
      // Hit når bara high-confidence-hopp (spärren ovan). firstLocated kan ändå ge null
      // när noden saknar koordinater — då bryts linjen (nästa ben börjar om).
      const point = firstLocated(resolved[i]);
      if (point && !points.some((p) => p.id === point.id)) points.push(point);
      if (point && prevPoint) {
        // SNR[i] är hop i:s mätning av länken från hop i-1 (backendens neighbor-edge-semantik).
        legs.push({
          from: prevPoint,
          to: point,
          snr: hops[i]?.snr ?? null,
        });
      }
      prevPoint = point;
      // Ett hopp utan kartpunkt bryter linjen: nästa ben börjar om från nästa säkra hopp.
    }
    if (legs.length === 0) {
      unresolvedCount += 1;
      continue;
    }
    if (!pathWithinLoRaRange(chainCoords(points, legs))) {
      outOfRangeCount += 1;
      continue;
    }
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
  // Dominant orsak rapporteras (short-hash först: den är åtgärdbar — "skicka med bredare
  // hashar" — medan range/unresolved är datafakta). Samma ordning som Paketsökvägen.
  const blockedCount = shortHashCount + ambiguousHopCount + outOfRangeCount + unresolvedCount;
  const blocked: TracePathsBlocked | null =
    paths.length > 0 || blockedCount === 0
      ? null
      : shortHashCount > 0
        ? {
            reason: 'short-hash',
            observedHashSize: widestObserved,
            count: blockedCount,
          }
        : ambiguousHopCount > 0
          ? { reason: 'ambiguous-hop', observedHashSize: widestObserved, count: blockedCount }
          : outOfRangeCount > 0
            ? {
                reason: 'out-of-range',
                observedHashSize: widestObserved,
                count: blockedCount,
              }
            : { reason: 'unresolved', observedHashSize: widestObserved, count: blockedCount };
  return { paths, blocked };
}

// Benens ändpunkter i ritordning, utan dubbletter där benen hänger ihop.
function chainCoords(points: TracePathPoint[], legs: TracePathLeg[]): [number, number][] {
  if (legs.length === 0) return points.map((p) => [p.lng, p.lat]);
  const coords: [number, number][] = [[legs[0]!.from.lng, legs[0]!.from.lat]];
  for (const leg of legs) coords.push([leg.to.lng, leg.to.lat]);
  return coords;
}

export interface TraceLegProps {
  key: string; // packetHash — isolerar ett paket vid val; "all" för det aggregerade lagret
  color: string; // paketets färg (väljaren)
  snrColor: string; // benets SNR-färg (samma skala som grannlinjerna)
  snr: number | null;
  snrSpread: number; // max − min över paketens mätningar (0 vid ett paket/enighet)
  snrSamples: number; // antal paket som mätte detta ben
  label: string; // "A → B · +3.50 dB" för popup (aggregerat: "A → B · +3.25 dB ±0.50 · 3 pkt")
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
// snrColor. Punkter dubblett-rensas per paket.
//
// Utan valt paket (selectedKey == null, "Alla sökvägar") aggregeras benen över paketen:
// varje distinkt nodpar ritas EN gång med medel-SNR över paketens mätningar av det benet
// (null där inget paket mätte). Per paket-isolering ritas varje pakets egna ben som förr.
export function tracePathsToFeatures(
  paths: TracePath[],
  selectedKey: string | null,
  palette: TraceSnrPalette = TRACE_SNR_FALLBACK,
): {
  lines: FeatureCollection<LineString, TraceLegProps>;
  points: FeatureCollection<Point, TracePointProps>;
  bounds: [number, number][];
} {
  if (selectedKey) return tracePacketFeatures(paths, selectedKey, palette);
  return traceAggregateFeatures(paths, palette);
}

// Samma ben sedda av flera paket slås ihop per nodpar (riktat: A→B ≠ B→A).
// SNR-medelvärde över de paket som mätte benet; spridning = max − min.
// Tvetydighet kan aldrig nå hit: buildTracePaths undanhåller hela paketet så fort
// något hopp inte är high-confidence (fail-closed, samma spärr som Paketsökvägen).
function aggregateLegs(paths: TracePath[]): TracePathAggregateLeg[] {
  const byPair = new Map<string, { from: TracePathPoint; to: TracePathPoint; snrs: number[] }>();
  for (const path of paths) {
    for (const leg of path.legs) {
      const key = `${leg.from.id}→${leg.to.id}`;
      const entry = byPair.get(key);
      if (entry) {
        if (leg.snr != null && Number.isFinite(leg.snr)) entry.snrs.push(leg.snr);
      } else {
        byPair.set(key, {
          from: leg.from,
          to: leg.to,
          snrs: leg.snr != null && Number.isFinite(leg.snr) ? [leg.snr] : [],
        });
      }
    }
  }
  return [...byPair.values()].map((entry) => {
    const snrs = entry.snrs;
    const snr = snrs.length > 0 ? snrs.reduce((a, b) => a + b, 0) / snrs.length : null;
    const snrSpread = snrs.length > 1 ? Math.max(...snrs) - Math.min(...snrs) : 0;
    return {
      from: entry.from,
      to: entry.to,
      snr,
      snrSpread,
      snrSamples: snrs.length,
    };
  });
}

export function formatAggregateSnrLabel(
  fromLabel: string,
  toLabel: string,
  snr: number | null,
  snrSpread: number,
  snrSamples: number,
): string {
  const endpoints = `${fromLabel} → ${toLabel}`;
  if (snr == null) return endpoints;
  const mean = `${snr.toFixed(2)} dB`;
  if (snrSamples <= 1) return `${endpoints} · ${mean}`;
  return `${endpoints} · ${mean} ±${(snrSpread / 2).toFixed(2)} · ${snrSamples} pkt`;
}

function traceAggregateFeatures(
  paths: TracePath[],
  palette: TraceSnrPalette,
): {
  lines: FeatureCollection<LineString, TraceLegProps>;
  points: FeatureCollection<Point, TracePointProps>;
  bounds: [number, number][];
} {
  const legs = aggregateLegs(paths);
  const lines: Feature<LineString, TraceLegProps>[] = [];
  const points: Feature<Point, TracePointProps>[] = [];
  const bounds: [number, number][] = [];

  legs.forEach((leg) => {
    const snrColor = traceLegColor(leg.snr, palette);
    const fromLabel = leg.from.name ?? leg.from.id.slice(0, 6);
    const toLabel = leg.to.name ?? leg.to.id.slice(0, 6);
    lines.push({
      type: 'Feature',
      properties: {
        key: 'all',
        color: snrColor,
        snrColor,
        snr: leg.snr,
        snrSpread: leg.snrSpread,
        snrSamples: leg.snrSamples,
        label: formatAggregateSnrLabel(fromLabel, toLabel, leg.snr, leg.snrSpread, leg.snrSamples),
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [leg.from.lng, leg.from.lat],
          [leg.to.lng, leg.to.lat],
        ],
      },
    });
    bounds.push([leg.from.lng, leg.from.lat]);
    if (leg === legs[legs.length - 1]) bounds.push([leg.to.lng, leg.to.lat]);
  });

  // Punkter: varje distinkt nod en gång, i första-ben-ordning.
  const seen = new Set<string>();
  const ordered: TracePathPoint[] = [];
  for (const leg of legs) {
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
        key: 'all',
        color: TRACE_PATH_COLORS[0]!,
        label: pt.name ?? pt.id.slice(0, 6),
        title: pt.name ?? pt.id,
        endpoint,
        packetLabel: '',
      },
      geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
    });
  });

  return {
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
    bounds,
  };
}

function tracePacketFeatures(
  paths: TracePath[],
  selectedKey: string,
  palette: TraceSnrPalette,
): {
  lines: FeatureCollection<LineString, TraceLegProps>;
  points: FeatureCollection<Point, TracePointProps>;
  bounds: [number, number][];
} {
  const shown = paths.filter((p) => p.key === selectedKey);
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
          snrSpread: 0,
          snrSamples: leg.snr != null ? 1 : 0,
          label: `${fromLabel} → ${toLabel}${leg.snr != null ? ` · ${leg.snr.toFixed(2)} dB` : ''}`,
        },
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
