import { describe, it, expect } from 'vitest';
import {
  parseMapViewSearch,
  buildCameraPatch,
  buildSettingsPatch,
  cameraMatchesUrl,
  settingsMatchUrl,
  urlCamera,
  type MapCamera,
  type MapSettingsState,
} from '../../../src/features/map/map-url';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  DEFAULT_PITCH,
  DEFAULT_BEARING,
  DEFAULT_CLUSTERED,
  DEFAULT_NEIGHBOR_LINES,
  DEFAULT_FLOW,
  DEFAULT_BORDERS,
} from '../../../src/features/map/types';

function parseMapView(params: URLSearchParams) {
  return parseMapViewSearch(Object.fromEntries(params.entries()));
}

describe('parseMapView', () => {
  it('is empty for no params', () => {
    expect(parseMapView(new URLSearchParams(''))).toEqual({});
  });

  it('reads lat+lng into a maplibre [lng, lat] center', () => {
    expect(parseMapView(new URLSearchParams('lat=45.32&lng=-75.66'))).toEqual({
      center: [-75.66, 45.32],
    });
  });

  it('omits the center unless BOTH lat and lng are present', () => {
    expect(parseMapView(new URLSearchParams('lat=45.32'))).toEqual({});
    expect(parseMapView(new URLSearchParams('lng=-75.66'))).toEqual({});
  });

  it('omits an out-of-range center', () => {
    expect(parseMapView(new URLSearchParams('lat=200&lng=0'))).toEqual({});
    expect(parseMapView(new URLSearchParams('lat=0&lng=500'))).toEqual({});
    expect(parseMapView(new URLSearchParams('lat=abc&lng=0'))).toEqual({});
  });

  it('reads a valid zoom and omits an out-of-range or malformed one', () => {
    expect(parseMapView(new URLSearchParams('zoom=9.4'))).toEqual({ zoom: 9.4 });
    expect(parseMapView(new URLSearchParams('zoom=0'))).toEqual({ zoom: 0 });
    expect(parseMapView(new URLSearchParams('zoom=99'))).toEqual({});
    expect(parseMapView(new URLSearchParams('zoom=-1'))).toEqual({});
    expect(parseMapView(new URLSearchParams('zoom=abc'))).toEqual({});
  });

  it('reads a valid pitch and omits an out-of-range or malformed one', () => {
    expect(parseMapView(new URLSearchParams('pitch=45'))).toEqual({ pitch: 45 });
    expect(parseMapView(new URLSearchParams('pitch=0'))).toEqual({ pitch: 0 });
    expect(parseMapView(new URLSearchParams('pitch=85'))).toEqual({ pitch: 85 });
    expect(parseMapView(new URLSearchParams('pitch=86'))).toEqual({});
    expect(parseMapView(new URLSearchParams('pitch=-1'))).toEqual({});
    expect(parseMapView(new URLSearchParams('pitch=abc'))).toEqual({});
  });

  it('reads a valid bearing and omits an out-of-range or malformed one', () => {
    expect(parseMapView(new URLSearchParams('bearing=45'))).toEqual({ bearing: 45 });
    expect(parseMapView(new URLSearchParams('bearing=-180'))).toEqual({ bearing: -180 });
    expect(parseMapView(new URLSearchParams('bearing=0'))).toEqual({ bearing: 0 });
    expect(parseMapView(new URLSearchParams('bearing=181'))).toEqual({});
    expect(parseMapView(new URLSearchParams('bearing=-181'))).toEqual({});
    expect(parseMapView(new URLSearchParams('bearing=abc'))).toEqual({});
  });

  it('reads clustering on/off, case-insensitively, ignoring junk', () => {
    expect(parseMapView(new URLSearchParams('clustering=on'))).toEqual({ clustered: true });
    expect(parseMapView(new URLSearchParams('clustering=OFF'))).toEqual({ clustered: false });
    expect(parseMapView(new URLSearchParams('clustering=maybe'))).toEqual({});
  });

  it('reads node_type by canonical name, case-insensitively, and drops unknown/All', () => {
    expect(parseMapView(new URLSearchParams('node_type=repeater'))).toEqual({
      nodeType: 'repeater',
    });
    expect(parseMapView(new URLSearchParams('node_type=Repeater'))).toEqual({
      nodeType: 'repeater',
    });
    expect(parseMapView(new URLSearchParams('node_type=room_server'))).toEqual({
      nodeType: 'room_server',
    });
    expect(parseMapView(new URLSearchParams('node_type=Room'))).toEqual({}); // label, not a name
    expect(parseMapView(new URLSearchParams('node_type=banana'))).toEqual({});
    expect(parseMapView(new URLSearchParams('node_type='))).toEqual({});
  });

  it('reads the 3-way neighbor_lines mode, case-insensitively', () => {
    expect(parseMapView(new URLSearchParams('neighbor_lines=on'))).toEqual({ neighborLines: 'on' });
    expect(parseMapView(new URLSearchParams('neighbor_lines=Selected'))).toEqual({
      neighborLines: 'selected',
    });
    expect(parseMapView(new URLSearchParams('neighbor_lines=off'))).toEqual({
      neighborLines: 'off',
    });
    expect(parseMapView(new URLSearchParams('neighbor_lines=nope'))).toEqual({});
  });

  it('ignores obsolete basemap URL overrides so the theme remains authoritative', () => {
    expect(parseMapView(new URLSearchParams('style=positron'))).toEqual({});
    expect(parseMapView(new URLSearchParams('style=dark'))).toEqual({});
  });

  it('reads the packet-flow toggle on/off', () => {
    expect(parseMapView(new URLSearchParams('flow=on'))).toEqual({ flow: true });
    expect(parseMapView(new URLSearchParams('flow=off'))).toEqual({ flow: false });
    expect(parseMapView(new URLSearchParams('flow=x'))).toEqual({});
  });

  it('reads the iata-borders toggle on/off', () => {
    expect(parseMapView(new URLSearchParams('borders=on'))).toEqual({ borders: true });
    expect(parseMapView(new URLSearchParams('borders=off'))).toEqual({ borders: false });
    expect(parseMapView(new URLSearchParams('borders=x'))).toEqual({});
  });

  it('combines every param into one view', () => {
    const params = new URLSearchParams(
      'lat=53.31&lng=-113.58&zoom=9&pitch=30&bearing=-45&clustering=off&node_type=repeater&neighbor_lines=on&flow=on&borders=on&meshcore_region=SE',
    );
    expect(parseMapView(params)).toEqual({
      center: [-113.58, 53.31],
      zoom: 9,
      pitch: 30,
      bearing: -45,
      clustered: false,
      nodeType: 'repeater',
      neighborLines: 'on',
      flow: true,
      borders: true,
      meshcoreRegion: 'se',
    });
  });

  it('reads a meshcore_region token, lowercasing and dropping malformed values', () => {
    expect(parseMapView(new URLSearchParams('meshcore_region=SE'))).toEqual({
      meshcoreRegion: 'se',
    });
    expect(parseMapView(new URLSearchParams('meshcore_region=*'))).toEqual({
      meshcoreRegion: '*',
    });
    expect(parseMapView(new URLSearchParams('meshcore_region=se,no'))).toEqual({});
    expect(parseMapView(new URLSearchParams('meshcore_region=se no'))).toEqual({});
    expect(parseMapView(new URLSearchParams('meshcore_region='))).toEqual({});
  });
});

describe('buildCameraPatch', () => {
  // The patch omits values equal to the configured neutral view, so expectations read from the same
  // defaults the helper compares against.
  const defaultCamera: MapCamera = {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    pitch: 0,
    bearing: 0,
  };

  it('emits rounded camera values for a moved camera', () => {
    expect(
      buildCameraPatch({
        center: [-113.583456, 53.312345],
        zoom: 9.4567,
        pitch: 44.56,
        bearing: -12.34,
      }),
    ).toEqual({
      lat: 53.31235,
      lng: -113.58346,
      zoom: 9.46,
      pitch: 44.6,
      bearing: -12.3,
    });
  });

  it('omits every neutral value: default center, default zoom, flat tilt, north-up rotation', () => {
    expect(buildCameraPatch(defaultCamera)).toEqual({});
  });

  it('keeps lat/lng paired (neither alone) and writes a default zoom only next to a moved center', () => {
    const movedCenter = buildCameraPatch({ ...defaultCamera, center: [12.34, 55.67] });
    expect(movedCenter).toEqual({ lat: 55.67, lng: 12.34 });
    const movedZoom = buildCameraPatch({ ...defaultCamera, zoom: 7.5 });
    expect(movedZoom).toEqual({ zoom: 7.5 });
  });

  it('omits flat tilt and north-up rotation but keeps non-neutral ones', () => {
    expect(buildCameraPatch({ ...defaultCamera, center: [1, 2], pitch: 0, bearing: 0 })).toEqual({
      lat: 2,
      lng: 1,
    });
    const tilted = buildCameraPatch({ ...defaultCamera, center: [1, 2], pitch: 45, bearing: 90 });
    expect(tilted.pitch).toBe(45);
    expect(tilted.bearing).toBe(90);
  });

  it('round-trips through parseMapView', () => {
    const camera: MapCamera = {
      center: [-113.58346, 53.31235],
      zoom: 9.46,
      pitch: 44.6,
      bearing: -12.3,
    };
    const patch = buildCameraPatch(camera);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) params.set(k, String(v));
    expect(parseMapView(params)).toEqual({
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    });
  });
});

describe('buildSettingsPatch + settingsMatchUrl', () => {
  const neutral: MapSettingsState = {
    clustered: DEFAULT_CLUSTERED,
    nodeType: '',
    neighborLines: DEFAULT_NEIGHBOR_LINES,
    flow: DEFAULT_FLOW,
    borders: DEFAULT_BORDERS,
    meshcoreRegion: '',
  };

  it('emits nothing for the neutral settings', () => {
    expect(buildSettingsPatch(neutral)).toEqual({});
    expect(settingsMatchUrl({}, neutral)).toBe(true);
  });

  it('emits only the non-neutral settings', () => {
    const settings = { ...neutral, clustered: false, nodeType: 'repeater', flow: true };
    expect(buildSettingsPatch(settings)).toEqual({
      clustering: false,
      node_type: 'repeater',
      flow: true,
    });
    expect(settingsMatchUrl({}, settings)).toBe(false);
    expect(settingsMatchUrl({ clustered: false, nodeType: 'repeater', flow: true }, settings)).toBe(
      true,
    );
  });

  it('reads absent params as their neutral values, so a param-less URL matches neutral settings', () => {
    expect(
      settingsMatchUrl(
        { clustered: false, neighborLines: 'on', borders: true },
        { ...neutral, clustered: false, neighborLines: 'on', borders: true },
      ),
    ).toBe(true);
    expect(
      settingsMatchUrl({ clustered: false }, neutral), // clustering off in URL, on in state
    ).toBe(false);
  });
});

describe('cameraMatchesUrl + urlCamera', () => {
  const defaultCamera: MapCamera = {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    pitch: 0,
    bearing: 0,
  };

  it('matches a param-less URL against the opening (neutral) camera', () => {
    expect(cameraMatchesUrl({}, defaultCamera)).toBe(true);
    expect(cameraMatchesUrl({}, { ...defaultCamera, zoom: defaultCamera.zoom + 0.1 })).toBe(false);
  });

  it('matches an exact camera link and rejects a moved one', () => {
    const url = parseMapView(new URLSearchParams('lat=57.7&lng=14.2&zoom=4&pitch=30&bearing=-25'));
    expect(cameraMatchesUrl(url, { center: [14.2, 57.7], zoom: 4, pitch: 30, bearing: -25 })).toBe(
      true,
    );
    expect(cameraMatchesUrl(url, { center: [14.2, 57.7], zoom: 5, pitch: 30, bearing: -25 })).toBe(
      false,
    );
    expect(cameraMatchesUrl(url, { center: [14.2, 57.7], zoom: 4, pitch: 0, bearing: -25 })).toBe(
      false,
    );
  });

  it('fills neutral defaults for absent pitch/zoom/bearing in urlCamera', () => {
    expect(urlCamera({})).toBeNull();
    const view = parseMapView(new URLSearchParams('lat=10&lng=20'));
    expect(urlCamera(view)).toEqual({
      center: [20, 10],
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
    });
    expect(urlCamera(parseMapView(new URLSearchParams('pitch=45')))).toBeNull(); // no center
  });
});
