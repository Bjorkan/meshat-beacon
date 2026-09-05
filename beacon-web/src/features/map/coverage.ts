// Coverage grid types: Beacon's own cached view of MeshMapper coverage.
// Mirrors beacon-server/internal/api/coverage.go. Cells carry an effective
// quality (0-3) and ping-age timestamps; SNR is nullable upstream.

export interface CoverageCellBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CoverageCell {
  gridId: string;
  bounds: CoverageCellBounds;
  coverageType: string; // BIDIR/TX/RX/DISC/DEAD/DROP
  effective: number; // 0-3 average quality
  count: number;
  timestamp?: number; // dominant (newest) ping, epoch seconds
  firstSeen?: number;
  snr?: number;
  snrMin?: number;
  snrMax?: number;
  statusMask: number;
}

export interface CoverageResponse {
  region: string;
  generatedAt: number; // epoch ms, when Beacon fetched upstream
  pingAgeSeconds?: number;
  totalSquares: number;
  pointCount: number;
  typeCounts?: Record<string, number>;
  cells: CoverageCell[];
  cached: boolean;
  upstreamFresh: boolean;
  disabled?: boolean;
}

export type CoverageMode = 'off' | 'effective' | 'age';

// effective 0-3 → red→yellow→green, matching the neighbour-graph obs ramp
// (danger → warn → green). DROP-heavy cells (effective ~0) read red, pure
// BIDIR (3.0) reads green. Alpha encodes confidence via ping count.
export function effectiveColor(effective: number): string {
  const t = Math.max(0, Math.min(1, effective / 3));
  // red (#bd2130) → yellow (#fd7e14-ish midpoint) → green (#1e7e34)
  const stops: [number, [number, number, number]][] = [
    [0, [0xbd, 0x21, 0x30]],
    [0.5, [0xfd, 0x7e, 0x14]],
    [1, [0x1e, 0x7e, 0x34]],
  ];
  let a = stops[0]!;
  let b = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i]![0] && t <= stops[i + 1]![0]) {
      a = stops[i]!;
      b = stops[i + 1]!;
      break;
    }
  }
  const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i]! - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Ping age in hours → opacity + hue: fresh (<6h) solid green-tinted, aging
// toward faint grey by 7 days. Cells without a timestamp render dim.
export function pingAgeOpacity(timestampSec: number | undefined, nowMs: number): number {
  if (timestampSec == null) return 0.15;
  const ageHours = (nowMs / 1000 - timestampSec) / 3600;
  if (ageHours <= 6) return 0.85;
  if (ageHours >= 24 * 7) return 0.15;
  const f = (ageHours - 6) / (24 * 7 - 6);
  return 0.85 - f * 0.7;
}

export function formatPingAge(timestampSec: number | undefined, nowMs: number): string {
  if (timestampSec == null) return 'unknown age';
  const ageMin = Math.max(0, (nowMs / 1000 - timestampSec) / 60);
  if (ageMin < 60) return `${Math.floor(ageMin)}m ago`;
  const ageH = ageMin / 60;
  if (ageH < 48) return `${Math.floor(ageH)}h ago`;
  return `${Math.floor(ageH / 24)}d ago`;
}
