// maplibre-gl v6 moved tile/GeoJSON parsing into a separate module worker (maplibre-gl-worker.mjs).
// The library resolves that file relative to its own import.meta.url, which the Vite build does not
// emit, so every map would start with a dead worker ("Worker failed to load" in the console, no
// layer features, no hit-testing). The npm worker file also imports a sibling maplibre-gl-shared
// chunk, so a raw ?url copy alone would 404 that import — ?worker&url makes Vite bundle the worker
// into a self-contained asset and hands its URL to maplibre before any Map instance is created.
// Every map entry point imports this module before maplibre-gl itself.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
