import type { ExpressionSpecification } from 'maplibre-gl';
import { nodeTypeColor } from '../node-type-colors';
import { CLUSTER_ICON_PREFIX, clusterSegments } from './cluster-style';
import { CLUSTER_RADIUS_STOPS } from './marker-scale';

// Shared dark face on both basemaps. The semantic contour is the only category treatment.
export const MARKER_FACE = '#1D2D38';
export const MARKER_TEXT = '#FFFFFF';
// The platform emoji renders the observer glyph natively on every device.
export const OBSERVER_EYE = '👁️';
const NODE_ICON_PREFIX = 'node-pill:';

export function nodeMarkerId(publicKey: string, type: string, observer: boolean): string {
  return `${NODE_ICON_PREFIX}${encodeURIComponent(type)}:${observer ? 1 : 0}:${publicKey.slice(0, 6).toUpperCase()}`;
}

export function nodeMarkerExpression(selectedId: string | null): ExpressionSpecification {
  return [
    'concat',
    ['get', 'markerImage'],
    ['case', ['==', ['get', 'id'], selectedId ?? ''], ':selected', ''],
  ];
}

function canvas(width: number, height: number, scale: number) {
  const element = document.createElement('canvas');
  element.width = Math.ceil(width * scale);
  element.height = Math.ceil(height * scale);
  // CPU-backed canvases keep getImageData readbacks reliable on GPU-accelerated Firefox, where
  // hardware canvases under memory pressure can read back black — and hundreds of runtime icons
  // have done exactly that. Drawing is one-shot, so software rasterization costs nothing.
  const context = element.getContext('2d', { willReadFrequently: true })!;
  context.scale(scale, scale);
  return { element, context };
}

function clusterRadius(total: number): number {
  for (let index = 1; index < CLUSTER_RADIUS_STOPS.length; index++) {
    const [upper, radius] = CLUSTER_RADIUS_STOPS[index]!;
    const [lower, previous] = CLUSTER_RADIUS_STOPS[index - 1]!;
    if (total <= upper)
      return previous + ((radius - previous) * Math.max(0, total - lower)) / (upper - lower);
  }
  return CLUSTER_RADIUS_STOPS.at(-1)![1];
}

function drawCluster(total: number, counts: number[], scale: number) {
  const segments = clusterSegments(counts);
  const radius = clusterRadius(total);
  const size = (radius + 2) * 2;
  const { element, context: ctx } = canvas(size, size, scale);
  const center = size / 2;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = MARKER_FACE;
  ctx.fill();
  // Butt joins and shared cumulative endpoints: no minimum slice or decorative gaps can
  // distort the real proportions, including tiny minority categories and single-colour clusters.
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'butt';
  for (const segment of segments) {
    ctx.beginPath();
    ctx.arc(
      center,
      center,
      radius - 3,
      segment.start * Math.PI * 2 - Math.PI / 2,
      segment.end * Math.PI * 2 - Math.PI / 2,
    );
    ctx.strokeStyle = segment.color;
    ctx.stroke();
  }
  ctx.fillStyle = MARKER_TEXT;
  const text = String(total);
  ctx.font = `700 ${text.length > 4 ? 12 : text.length > 3 ? 14 : 16}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, center, center - 3, radius * 1.4);
  const spacing = 7;
  segments.forEach((segment, index) => {
    ctx.beginPath();
    ctx.arc(
      center + (index - (segments.length - 1) / 2) * spacing,
      center + 9,
      2.1,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = segment.color;
    ctx.fill();
  });
  return ctx.getImageData(0, 0, element.width, element.height);
}

function drawNode(
  label: string,
  type: string,
  observer: boolean,
  selected: boolean,
  scale: number,
) {
  const width = observer ? 94 : 76;
  const height = 32;
  const { element, context: ctx } = canvas(width, height, scale);
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height - 2, 15);
  ctx.fillStyle = MARKER_FACE;
  ctx.fill();
  if (selected) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = MARKER_TEXT;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.roundRect(3.5, 3.5, width - 7, height - 7, 12);
  ctx.strokeStyle = nodeTypeColor(type);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = MARKER_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (observer) {
    ctx.font = '13px sans-serif';
    ctx.fillText(OBSERVER_EYE, 19, 17);
  }
  ctx.font = '700 12px monospace';
  ctx.fillText(label, width / 2 + (observer ? 9 : 0), height / 2 + 0.5);
  return ctx.getImageData(0, 0, element.width, element.height);
}

// Synchronous styleimagemissing handler: draw only images requested by the visible map tiles.
// Keys contain the actual counts/content, so changing filters or membership cannot reuse stale art.
export function rasterizeMapMarker(id: string, pixelRatio: number): ImageData | null {
  if (id.startsWith(CLUSTER_ICON_PREFIX)) {
    const [total = 0, ...counts] = id.slice(CLUSTER_ICON_PREFIX.length).split(':').map(Number);
    if (
      counts.length !== 5 ||
      ![total, ...counts].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      total < 2 ||
      counts.reduce((a, b) => a + b, 0) !== total
    )
      return null;
    return drawCluster(total, counts, pixelRatio);
  }
  if (id.startsWith(NODE_ICON_PREFIX)) {
    const [type, observer = '', label, selected] = id.slice(NODE_ICON_PREFIX.length).split(':');
    if (!type || !label || !/^[\da-f]{1,6}$/i.test(label) || !['0', '1'].includes(observer))
      return null;
    return drawNode(
      label,
      decodeURIComponent(type),
      observer === '1',
      selected === 'selected',
      pixelRatio,
    );
  }
  return null;
}
