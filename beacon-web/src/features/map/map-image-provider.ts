import type { Map as MapLibreMap } from 'maplibre-gl';

// MapLibre 6 resolves a missing style image through the map's single missing-image resolver
// (setMissingStyleImageResolver) before the requesting tile/layout request completes;
// styleimagemissing fires only afterwards and can no longer satisfy the request. Node/cluster
// markers are rasterized by useMapNodes, which owns device-pixel-ratio tracking and image
// cleanup, so the map-level resolver installed by useMapLibre dispatches `node-` ids to whichever
// provider instance is currently mounted.
type NodeImageProvider = (id: string) => void;

let nodeImageProvider: NodeImageProvider | null = null;

export function setNodeImageProvider(provider: NodeImageProvider | null): void {
  nodeImageProvider = provider;
}

// Identity-checked so a late cleanup of a previous hook instance cannot unregister its successor.
export function clearNodeImageProvider(provider: NodeImageProvider): void {
  if (nodeImageProvider === provider) nodeImageProvider = null;
}

// One resolver per map, dispatching by id prefix. Called by MapLibre with every id the current
// style/tiles request that has no image yet; adding the image here satisfies the in-flight request.
export function provideMissingStyleImage(map: MapLibreMap, id: string): void {
  if (id.startsWith('node-')) {
    nodeImageProvider?.(id);
    return;
  }
  // The OpenFreeMap base styles reference a few sprite icons their sprite doesn't ship. A missing
  // icon already draws nothing, so a transparent 1x1 placeholder keeps the identical look while
  // silencing the repeated "could not be loaded" warnings.
  if (!map.hasImage(id)) map.addImage(id, new ImageData(1, 1));
}
