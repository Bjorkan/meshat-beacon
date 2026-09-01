import {
  NODE_ICON_UNKNOWN,
  nodeIconId,
  NODE_TYPE_NAMES,
} from "./types";

// Marker icons: per-type SVGs recolored and rasterized to MapLibre images (unknown type = canvas ring).
// Clusters are native circle/text layers, so they do not participate in the async image pipeline.

// Glyph SVGs as raw text per type (+ observer variant). Marker style follows the basemap: filled
// Glitch on dark, hollow Wireframe on light — which is exactly what isDark encodes. import.meta.glob
// needs literal args (Vite resolves them at build time), so the two option blocks are repeated.
const GLITCH = import.meta.glob("./markers/glitch/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const WIREFRAME = import.meta.glob("./markers/wireframe/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function svgText(type: string, observer: boolean, isDark: boolean): string | undefined {
  const style = isDark ? "glitch" : "wireframe";
  const set = isDark ? GLITCH : WIREFRAME;
  return set[`./markers/${style}/${type}${observer ? "-observer" : ""}.svg`];
}

// Per-type node color (theme palette var + hard fallback). Drives the glyph via the SVG's currentColor.
const NODE_TYPE_COLOR: Record<string, { colorVar: string; fallback: string }> = {
  companion: { colorVar: "--palette-primary", fallback: "#3B82F6" },
  repeater: { colorVar: "--palette-secondary", fallback: "#A78BFA" },
  room_server: { colorVar: "--palette-green", fallback: "#22C55E" },
  sensor: { colorVar: "--palette-warn", fallback: "#EAB308" },
};

// Observer is a ROLE pip layered on any type; keep a fixed accent so it reads consistently and
// contrasts the (theme-tinted) node color.
export const OBSERVER_COLOR = "#c79bff";

// On the light basemaps the hollow Wireframe glyph loses contrast, so a near-white disc is filled
// behind it (a dark disc clashed with the saturated glyph). Sized to the outer ring (r=29 in the
// 88-unit padded viewBox) so it lines up.
const WIREFRAME_BACKING = "rgba(255, 255, 255, 0.95)";
const RING_R = 29; // outer ring radius in the (padded) 88-unit viewBox

export const nodeObserverIconId = (type: string): string => `${nodeIconId(type)}-observer`;

// Selection ring as a SYMBOL (not a circle) so it can ride onto a spiderfied leaf — see
// syncLeafSelectionRing in useMapNodes.
export const SELECTION_RING_ICON_ID = "node-selection-ring";

// Every image id the active map layers reference, so they can be provided up front.
export const MAP_ICON_IDS: string[] = [
  ...NODE_TYPE_NAMES.flatMap((t) => [nodeIconId(t), nodeObserverIconId(t)]),
  NODE_ICON_UNKNOWN,
  SELECTION_RING_ICON_ID,
];

const ICON_SIZE = 24; // logical px for the canvas-drawn ring
const MARKER_SIZE = 36; // logical px for SVG glyphs incl. glow padding (64 glyph in an 88 padded box)
// Render at ~2x device pixel ratio (capped): resolution headroom so icons stay crisp at icon-size 1,
// under the cluster layer's up-to-1.5x scaling, under sub-pixel placement, and across DPR changes.
function currentScale(): number {
  return Math.min(6, 2 * Math.ceil(window.devicePixelRatio || 1));
}

// Recolor + pad a glyph SVG. The SVG is currentColor/var-driven, so one node color drives
// glyph+fill+glow (the observer pip keeps its own accent). The viewBox is padded so the
// overflow:visible glow isn't clipped; on light basemaps the neon glow becomes a subtle dark halo.
function styleSvg(
  svg: string,
  nodeColor: string,
  isDark: boolean,
  box: { base: number; padded: number } = { base: 64, padded: 88 },
): string {
  const pad = (box.padded - box.base) / 2;
  let out = svg
    .replace(/var\(--node-color,\s*#[0-9a-fA-F]{3,8}\)/g, nodeColor)
    .replace(/var\(--observer-color,\s*#[0-9a-fA-F]{3,8}\)/g, OBSERVER_COLOR)
    .replace(`viewBox="0 0 ${box.base} ${box.base}"`, `viewBox="${-pad} ${-pad} ${box.padded} ${box.padded}"`)
    .replace(`width="${box.base}" height="${box.base}"`, `width="${box.padded}" height="${box.padded}"`);
  if (!isDark) {
    out = out.replace("drop-shadow(0 0 4px currentColor)", "drop-shadow(0 0 2px rgba(0,0,0,0.55))");
  }
  return out;
}

async function rasterizeSvg(
  svg: string,
  scale: number,
  logicalSize: number = MARKER_SIZE,
  backing?: string,
): Promise<ImageData> {
  const px = Math.round(logicalSize * scale);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg image load failed"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    if (backing) {
      // solid disc behind the glyph, sized to the outer ring (88-unit padded viewBox is centered)
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, (RING_R / 88) * px, 0, Math.PI * 2);
      ctx.fillStyle = backing;
      ctx.fill();
    }
    ctx.drawImage(img, 0, 0, px, px);
    return ctx.getImageData(0, 0, px, px);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Canvas-drawn ring for unknown device types (no glyph in the set).
function drawRing(color: string, scale: number): ImageData {
  const size = ICON_SIZE * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, size * 0.08) * 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// Selection ring icon — matches the unclustered ring (r=13, 2.5px stroke, 0.95 opacity) but as an
// image so it can ride the symbol pipeline onto a spiderfied leaf. Centered in a 32-unit box.
const SELECTION_RING_SIZE = 32; // logical px box
function drawSelectionRing(color: string, scale: number): ImageData {
  const size = SELECTION_RING_SIZE * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 13 * scale, 0, Math.PI * 2);
  ctx.lineWidth = 2.5 * scale;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.95;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

export interface RasterIcon {
  data: ImageData;
  pixelRatio: number;
}

// Produce the maplibre image for one icon id, themed for the current palette + basemap. Returns
// null for unrecognized ids.
export async function rasterizeNodeIcon(id: string, isDark: boolean): Promise<RasterIcon | null> {
  const scale = currentScale();
  const styles = getComputedStyle(document.documentElement);

  if (id === NODE_ICON_UNKNOWN) {
    const muted = styles.getPropertyValue("--palette-text-muted").trim() || "#73737B";
    return { data: drawRing(muted, scale), pixelRatio: scale };
  }
  if (id === SELECTION_RING_ICON_ID) {
    const primary = styles.getPropertyValue("--palette-primary").trim() || "#3B82F6";
    return { data: drawSelectionRing(primary, scale), pixelRatio: scale };
  }

  const PREFIX = "node-";
  if (!id.startsWith(PREFIX)) return null;
  const observer = id.endsWith("-observer");
  const type = id.slice(PREFIX.length).replace(/-observer$/, "");
  const color = NODE_TYPE_COLOR[type];
  const svg = svgText(type, observer, isDark);
  if (!color || !svg) return null;
  const nodeColor = styles.getPropertyValue(color.colorVar).trim() || color.fallback;
  // light basemaps use the hollow Wireframe glyph -> give it a solid backing for contrast
  const backing = isDark ? undefined : WIREFRAME_BACKING;
  const data = await rasterizeSvg(styleSvg(svg, nodeColor, isDark), scale, MARKER_SIZE, backing);
  return { data, pixelRatio: scale };
}
