import { hasMapLocation } from './location';
import { useMapNeighborHighlight } from './useMapNeighborHighlight';
import { readPreference, writePreference } from '../../lib/storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapLibre } from './useMapLibre';
import { useMapNodes } from './useMapNodes';
import { useMapNeighbors } from './useMapNeighbors';
import { useMapFocusedNeighbors } from './useMapFocusedNeighbors';
import { useMapBorders } from './useMapBorders';
import { useMapBordersData } from './useMapBordersData';
import { useMapPacketFlow } from './useMapPacketFlow';
import { PacketFlowButton } from './PacketFlowButton';
import { LivePacketFeed } from './LivePacketFeed';
import { useMapNodesData } from './useMapNodesData';
import {
  nodesToFeatureCollection,
  filterByNodeType,
  buildNeighborEdges,
  buildFocusedNeighborEdges,
  buildFocusedNeighborPoints,
  buildFocusedSelectedPoint,
  neighborRenderMode,
  type NeighborEdgeProps,
} from './node-geojson';
import { MapLegend } from './MapLegend';
import { MapSettingsPanel } from './MapSettingsPanel';
import {
  buildCameraPatch,
  buildSettingsPatch,
  cameraMatchesUrl,
  settingsMatchUrl,
  urlCamera,
  type ParsedMapView,
} from './map-url';
import {
  MAP_BORDERS_STORAGE_KEY,
  mapStyleForTheme,
  resolveMapStyle,
  MAP_NEIGHBOR_LINES_STORAGE_KEY,
  MAP_CLUSTER_STORAGE_KEY,
  MAP_NODE_TYPE_STORAGE_KEY,
  MAP_MESHCORE_REGION_STORAGE_KEY,
  DEFAULT_ZOOM,
  type NeighborLinesMode,
} from './types';
import type { FeatureCollection, LineString } from 'geojson';
import { EmptyState } from '../../components/EmptyState';
import { LoadingPill } from '../../components/LoadingPill';
import { useRegion } from '../../hooks/useRegion';
import { useTheme } from '../../hooks/useTheme';
import { iataQueries, nodeQueries } from '../../api/queries';
import type { WsManager } from '../../api/ws-manager';

const EMPTY_EDGES: FeatureCollection<LineString, NeighborEdgeProps> = {
  type: 'FeatureCollection',
  features: [],
};

interface MapViewProps {
  wsManager: WsManager;
  // shared with the Nodes tab (lifted to the nodes route) so the open NodeDetailPanel stays live
  selectedNodeId: string | null;
  hoveredNeighborId?: string | null;
  onSelectNode: (id: string | null) => void;
  onOpenPacket: (packetHash: string) => void;
  // validated /map search params, parsed by the router (parseMapViewSearch)
  urlView: ParsedMapView;
}

export function MapView({
  wsManager,
  selectedNodeId,
  hoveredNeighborId = null,
  onSelectNode,
  onOpenPacket,
  urlView,
}: MapViewProps) {
  const { t, i18n } = useTranslation();
  // Deep-link params, read once at mount (like the region's ?iata seed). Each setting below is seeded
  // URL -> localStorage -> default; the URL wins for this session but is never written back to
  // localStorage, so a shared link can't clobber the visitor's saved prefs.

  const [typeFilter, setTypeFilter] = useState(
    () => urlView.nodeType ?? readPreference(MAP_NODE_TYPE_STORAGE_KEY) ?? '',
  ); // "" = All
  const handleTypeChange = useCallback((t: string) => {
    setTypeFilter(t);
    writePreference(MAP_NODE_TYPE_STORAGE_KEY, t);
  }, []);

  const [clustered, setClustered] = useState(
    () => urlView.clustered ?? readPreference(MAP_CLUSTER_STORAGE_KEY) !== 'off',
  );
  const handleClusteredChange = useCallback((c: boolean) => {
    setClustered(c);
    writePreference(MAP_CLUSTER_STORAGE_KEY, c ? 'on' : 'off');
  }, []);

  const [neighborLines, setNeighborLines] = useState<NeighborLinesMode>(() => {
    if (urlView.neighborLines) return urlView.neighborLines;
    const stored = readPreference(MAP_NEIGHBOR_LINES_STORAGE_KEY);
    return stored === 'on' || stored === 'selected' || stored === 'off' ? stored : 'selected';
  });
  const handleNeighborLinesChange = useCallback((mode: NeighborLinesMode) => {
    setNeighborLines(mode);
    writePreference(MAP_NEIGHBOR_LINES_STORAGE_KEY, mode);
  }, []);

  // MeshCore Region filter: a confirmed MeshCore region-scope token ("" = All). Composes with the global
  // IATA/region selector — the server intersects them. Changing it clears the node selection so a
  // filtered-out node never lingers as a ghost marker or edge.
  const [meshcoreRegionFilter, setMeshcoreRegionFilter] = useState(
    () => urlView.meshcoreRegion ?? readPreference(MAP_MESHCORE_REGION_STORAGE_KEY) ?? '',
  );
  const handleMeshcoreRegionChange = useCallback(
    (token: string) => {
      setMeshcoreRegionFilter(token);
      writePreference(MAP_MESHCORE_REGION_STORAGE_KEY, token);
      onSelectNode(null);
    },
    [onSelectNode],
  );

  // live packet-flow animation: opt-in per session (off by default, not persisted; a deep link can seed it)
  const [packetFlow, setPacketFlow] = useState(() => urlView.flow ?? false);
  const [packetFlowSession, setPacketFlowSession] = useState(0);

  // IATA borders are opt-in; explicit URL and saved preferences still take precedence.
  const [borders, setBorders] = useState(
    () => urlView.borders ?? readPreference(MAP_BORDERS_STORAGE_KEY) === 'on',
  );
  const handleBordersChange = useCallback((on: boolean) => {
    setBorders(on);
    writePreference(MAP_BORDERS_STORAGE_KEY, on ? 'on' : 'off');
  }, []);

  // A deep-link camera opens the map here and suppresses the initial region fit (see useMapLibre);
// tilt/rotation ride along so a shared link restores the exact view.
  const initialCamera = useMemo(
    () =>
      urlView.center
        ? {
            center: urlView.center,
            zoom: urlView.zoom ?? DEFAULT_ZOOM,
            pitch: urlView.pitch,
            bearing: urlView.bearing,
          }
        : undefined,
    [urlView],
  );

  const { iatas: selectedIatas, regionKey } = useRegion();
  // marker/cluster icons are canvas-drawn from the active --palette-* vars, so useMapNodes has to
  // re-register them whenever the palette changes: on a theme switch, and once on load when the async
  // themes populate (from [] -> filled).
  const { themeId, themes } = useTheme();
  const themeKey = themes.length ? themeId : '';
  // The basemap follows the app theme (Meshat Dark → dark tiles, Meshat Light → light tiles); a
  // The basemap always follows the app theme. Historical ?style= links are ignored so they cannot
  // pin the map to a dark style after a user selects the light theme.
  const styleId = mapStyleForTheme(themeId);
  const { data: iatas } = useQuery(iataQueries.list());

  // nodes for the selected region (its own key, independent of the Nodes-table filters/page cap).
  // Uses large pages so loading a deployment-wide map does not exhaust the REST request budget.
  const {
    nodes,
    loadedCount,
    isPaging,
    isError: nodesError,
  } = useMapNodesData(selectedIatas, regionKey, meshcoreRegionFilter);

  // split memos: rebuild the FeatureCollection only when nodes change; a type-filter change just
  // re-filters the already-built collection instead of re-running the full transform over all nodes
  const baseFc = useMemo(() => nodesToFeatureCollection(nodes), [nodes]);
  const geojson = useMemo(() => filterByNodeType(baseFc, typeFilter), [baseFc, typeFilter]);

  // Selected mode colours the one node's edges by observation count + freshness, which only the node
  // detail endpoint carries (the list's neighborIds are bare uuids). Shares the panel's query cache
  // (same key), so selecting a node — which opens the panel — usually has this already warm.
  const focusEnabled = neighborLines !== 'off' && !!selectedNodeId;
  const { data: focusNeighbors } = useQuery({
    ...nodeQueries.neighbors(selectedNodeId ?? ''),
    enabled: focusEnabled,
  });
  // A focused neighbor can sit outside the current region/list page. Reuse the detail-panel query so
  // its coordinates remain available after selection instead of letting the next edge set collapse.
  const { data: selectedNodeDetail } = useQuery({
    ...nodeQueries.detail(selectedNodeId ?? ''),
    enabled: !!selectedNodeId,
  });
  const selectedNodeForFocus = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? selectedNodeDetail,
    [nodes, selectedNodeId, selectedNodeDetail],
  );

  // Ambient neighbor lines are useful in normal browsing but compete directly with Live packet
  // paths. Selection always wins: both visible modes become a focused inspection view backed by the
  // detailed neighbor endpoint, while Live suppresses only the unrelated ambient mesh.
  const neighborEdges = useMemo(() => {
    const renderMode = neighborRenderMode(neighborLines, selectedNodeId, packetFlow);
    if (renderMode === 'off') return EMPTY_EDGES;
    if (renderMode === 'focused') {
      return buildFocusedNeighborEdges(selectedNodeForFocus, focusNeighbors ?? []);
    }
    return buildNeighborEdges(nodes, 'on', null);
  }, [nodes, neighborLines, selectedNodeId, selectedNodeForFocus, focusNeighbors, packetFlow]);
  const focusedNeighborPoints = useMemo(
    () =>
      selectedNodeId && neighborLines !== 'off'
        ? {
            type: 'FeatureCollection' as const,
            features: [
              ...buildFocusedSelectedPoint(selectedNodeForFocus).features,
              ...buildFocusedNeighborPoints(selectedNodeId, focusNeighbors ?? []).features,
            ],
          }
        : { type: 'FeatureCollection' as const, features: [] },
    [selectedNodeId, selectedNodeForFocus, neighborLines, focusNeighbors],
  );

  // IATA coords to frame: the selection's airports, or every airport for "All". Regions carry no
  // bounds from the API, so their member IATAs stand in for the extent. See CLAUDE.md (map framing).
  const fitPoints = useMemo<[number, number][] | null>(() => {
    const withCoords = (iatas ?? []).filter((i) => i.lat != null && i.lon != null);
    if (withCoords.length === 0) return null;
    const scope = selectedIatas && selectedIatas.length > 0 ? new Set(selectedIatas) : null;
    const chosen = scope ? withCoords.filter((i) => scope.has(i.iata)) : withCoords;
    return chosen.length > 0 ? chosen.map((i) => [i.lon!, i.lat!]) : null;
  }, [iatas, selectedIatas]);

  // Borders to draw: the selected region's IATAs, or every IATA for "All" (most have none configured,
  // which resolves to a 204 and is dropped). Only fetched while the layer is toggled on.
  const borderIatas = useMemo(() => {
    const all = (iatas ?? []).map((i) => i.iata);
    return selectedIatas && selectedIatas.length > 0
      ? all.filter((c) => selectedIatas.includes(c))
      : all;
  }, [iatas, selectedIatas]);
  const borderData = useMapBordersData(borderIatas, borders);

  // No onStyleError handler: with the style derived from the theme there's no alternate selection to
  // revert to — useMapLibre still pins its internal last-good style so a failed swap keeps rendering.
  const { containerRef, mapRef, isReady, styleRevision, error } = useMapLibre(
    styleId,
    fitPoints,
    undefined,
    initialCamera,
    packetFlow,
    i18n.language,
  );
  const isDark = resolveMapStyle(styleId).dark; // drives marker theming + maplibre control chrome
  const mapThemeKey = `${themeKey}:${styleRevision}`;

  // A selected-node deep link should open at inspection scale even when the node sits outside the
  // currently loaded region. The same restrained move also helps when following a focused neighbor.
  const lastFocusedNodeRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || !selectedNodeId || !selectedNodeForFocus) return;
    if (!hasMapLocation(selectedNodeForFocus)) return;
    if (lastFocusedNodeRef.current === selectedNodeId) return;
    lastFocusedNodeRef.current = selectedNodeId;
    map.flyTo({
      center: [selectedNodeForFocus.lng, selectedNodeForFocus.lat],
      padding: map.getPadding(),
      zoom: Math.max(map.getZoom(), 12),
      duration: 650,
      essential: true,
    });
  }, [mapRef, isReady, selectedNodeId, selectedNodeForFocus]);
  useEffect(() => {
    if (!selectedNodeId) lastFocusedNodeRef.current = null;
  }, [selectedNodeId]);

  // Mask the unavoidable source re-index between clustered/unclustered presentations with a short,
  // subtle canvas fade. Re-triggering the class handles rapid On/Off/Live changes without remounting.
  const presentationKey = `${clustered && !packetFlow}:${packetFlow}`;
  const previousPresentationRef = useRef(presentationKey);
  useEffect(() => {
    if (previousPresentationRef.current === presentationKey) return;
    previousPresentationRef.current = presentationKey;
    const container = mapRef.current?.getContainer();
    if (!container) return;
    container.classList.remove('map-presentation-transition');
    void container.offsetWidth;
    container.classList.add('map-presentation-transition');
    const timer = window.setTimeout(
      () => container.classList.remove('map-presentation-transition'),
      280,
    );
    return () => window.clearTimeout(timer);
  }, [mapRef, presentationKey]);

  // ── live URL sync ─────────────────────────────────────────────────────────────────────────────
  // The address bar always mirrors the map: camera (lat/lng/zoom/pitch/bearing) after every move,
  // settings after every toggle — so copying the URL at any moment shares the exact view. Writes
  // use replace (no history spam). An arriving URL with foreign values (a pasted deep link) flows
  // the other way: its settings are adopted and its camera flies. Params a region navigation
  // strips are regained by the same loop.

  const navigate = useNavigate({ from: '/map' });
  const urlViewRef = useRef(urlView); // read by the moveend writer without re-attaching per render
  useEffect(() => {
    urlViewRef.current = urlView;
  }, [urlView]);

  // Adopt a foreign deep link during render — the react-hooks-endorsed alternative to setState in
  // effects. The serialized view is the change detector: our own URL writes round-trip values
  // identical to the live settings, so they adopt as no-ops. Absent params never adopt, keeping
  // storage-seeded state intact.
  const urlKey = JSON.stringify(urlView);
  const [lastUrlKey, setLastUrlKey] = useState(urlKey);
  if (urlKey !== lastUrlKey) {
    setLastUrlKey(urlKey);
    if (urlView.clustered !== undefined && urlView.clustered !== clustered)
      setClustered(urlView.clustered);
    if (urlView.nodeType !== undefined && urlView.nodeType !== typeFilter)
      setTypeFilter(urlView.nodeType);
    if (urlView.neighborLines !== undefined && urlView.neighborLines !== neighborLines)
      setNeighborLines(urlView.neighborLines);
    if (urlView.flow !== undefined && urlView.flow !== packetFlow) setPacketFlow(urlView.flow);
    if (urlView.borders !== undefined && urlView.borders !== borders) setBorders(urlView.borders);
    if (urlView.meshcoreRegion !== undefined && urlView.meshcoreRegion !== meshcoreRegionFilter)
      setMeshcoreRegionFilter(urlView.meshcoreRegion);
  }

  // Settings -> URL whenever they differ from it: local toggles, storage-seeded state on a
  // param-less load, or params a region navigation stripped. Only non-neutral settings are written
  // (an absent param means the neutral default). Camera keys ride along untouched (prev) — the
  // moveend writer below owns them.
  useEffect(() => {
    const settings = {
      clustered,
      nodeType: typeFilter,
      neighborLines,
      flow: packetFlow,
      borders,
      meshcoreRegion: meshcoreRegionFilter,
    };
    if (settingsMatchUrl(urlView, settings)) return;
    navigate({
      to: '.',
      // The patch omits neutral keys, so each managed key is set explicitly — undefined drops a
      // stale param from the URL (e.g. clustering=off returning to the clustered default).
      search: (prev) => {
        const patch = buildSettingsPatch(settings);
        return {
          ...prev,
          clustering: patch.clustering,
          node_type: patch.node_type,
          neighbor_lines: patch.neighbor_lines,
          flow: patch.flow,
          borders: patch.borders,
          meshcore_region: patch.meshcore_region,
        };
      },
      replace: true,
    });
  }, [urlView, clustered, typeFilter, neighborLines, packetFlow, borders, meshcoreRegionFilter, navigate]);

  // Camera: fly to an arriving deep-link camera that differs from the live one. Our own writes
  // round-trip equal, so they skip. Absent tilt/rotation in a link mean the flat defaults.
  useEffect(() => {
    const map = mapRef.current;
    const target = urlCamera(urlView);
    if (!map || !target) return;
    const center = map.getCenter();
    if (
      cameraMatchesUrl(urlView, {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      })
    )
      return;
    map.flyTo({ ...target, essential: true });
  }, [urlView, isReady, mapRef]);

  // Camera -> URL. moveend covers pan/zoom/fly/rotate/tilt ends; the immediate write makes the view
  // the map opens with (deep-link camera or default) shareable before any move. Neutral values are
  // omitted, so a default view keeps the URL clean until the camera actually moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const write = () => {
      const center = map.getCenter();
      const camera = {
        center: [center.lng, center.lat] as [number, number],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
      if (cameraMatchesUrl(urlViewRef.current, camera)) return;
      navigate({
        to: '.',
        // Same explicit-set pattern as the settings writer: neutral camera values drop their keys
        // (e.g. returning Home to the default view clears lat/lng/zoom, flat tilt clears pitch).
        search: (prev) => {
          const patch = buildCameraPatch(camera);
          return {
            ...prev,
            lat: patch.lat,
            lng: patch.lng,
            zoom: patch.zoom,
            pitch: patch.pitch,
            bearing: patch.bearing,
          };
        },
        replace: true,
      });
    };
    write();
    map.on('moveend', write);
    return () => {
      map.off('moveend', write);
    };
  }, [isReady, navigate, mapRef]);

  useMapNodes(
    mapRef,
    isReady,
    geojson,
    isDark,
    mapThemeKey,
    clustered,
    packetFlow,
    onSelectNode,
    selectedNodeId,
    `${regionKey}:${typeFilter}`,
  );
  useMapNeighbors(mapRef, isReady, neighborEdges, mapThemeKey);
  useMapFocusedNeighbors(
    mapRef,
    isReady,
    focusedNeighborPoints,
    packetFlow,
    mapThemeKey,
    onSelectNode,
  );
  useMapNeighborHighlight(
    mapRef,
    isReady,
    hoveredNeighborId,
    packetFlow,
    mapThemeKey,
    focusedNeighborPoints,
  );
  useMapBorders(mapRef, isReady, borderData, mapThemeKey);
  useMapPacketFlow(mapRef, isReady, packetFlow, wsManager, mapThemeKey, regionKey);

  return (
    <div
      className={`@container relative flex flex-1 min-h-0 min-w-0 ${selectedNodeId ? 'max-lg:mb-14' : ''}`}
    >
      {/* Fill via flex-1, NOT absolute inset-0: maplibre adds .maplibregl-map { position: relative }
          to this element, which overrides Tailwind's `absolute` and would collapse inset-0 to 0
          height. data-dark drives the maplibre control theming in index.css. */}
      <div ref={containerRef} data-dark={isDark} className="flex-1" />
      {/* Shared flow prevents panel collisions. Use the map's width, including when a node
          sidebar is open, and leave the right-hand navigation controls their own lane. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 bottom-24 z-10 flex min-h-0 flex-col gap-2 @3xl:flex-row @3xl:items-start @3xl:justify-between">
        <div className="pointer-events-auto flex min-h-0 max-h-full min-w-0 max-w-[calc(100%-3.5rem)] flex-col @3xl:max-w-64">
          <MapSettingsPanel
            typeFilter={typeFilter}
            onTypeChange={handleTypeChange}
            clustered={clustered}
            onClusteredChange={handleClusteredChange}
            liveMode={packetFlow}
            neighborLines={neighborLines}
            onNeighborLinesChange={handleNeighborLinesChange}
            borders={borders}
            onBordersChange={handleBordersChange}
            meshcoreRegion={meshcoreRegionFilter}
            onMeshcoreRegionChange={handleMeshcoreRegionChange}
          >
            <MapLegend
              borders={borders}
              neighbors={neighborEdges.features.length > 0}
              live={packetFlow}
              clustered={clustered && !packetFlow}
              selected={!!selectedNodeId}
            />
          </MapSettingsPanel>
        </div>
        {packetFlow && (
          <div className="pointer-events-auto mt-auto flex max-h-[40%] min-h-0 min-w-0 max-w-full shrink-0 flex-col @3xl:mt-0 @3xl:mr-12 @3xl:max-h-full @3xl:max-w-90">
            <LivePacketFeed
              active={packetFlow}
              resetKey={`${regionKey}:${packetFlowSession}`}
              selectedIatas={selectedIatas}
              wsManager={wsManager}
              onOpenPacket={onOpenPacket}
            />
          </div>
        )}
      </div>
      <PacketFlowButton
        active={packetFlow}
        onToggle={() => {
          if (!packetFlow) setPacketFlowSession((session) => session + 1);
          setPacketFlow((value) => !value);
        }}
      />
      {/* A dedicated bottom lane keeps status clear of settings, the feed and LIVE. */}
      <LoadingPill
        loading={isPaging}
        error={nodesError}
        count={loadedCount}
        noun={t('entities.nodes')}
        position="bottom-14 left-1/2 -translate-x-1/2 w-max"
      />
      {error && (
        // z-20 so the failure overlay covers the settings card (z-10) instead of it floating on top
        <div className="absolute inset-0 z-20 bg-bg-base">
          <EmptyState title={t('map.failed')} subtitle={t('map.failedHint')} />
        </div>
      )}
    </div>
  );
}
