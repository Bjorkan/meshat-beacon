import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMapLibre } from "./useMapLibre";
import { useMapNodes } from "./useMapNodes";
import { useMapNeighbors } from "./useMapNeighbors";
import { useMapFocusedNeighbors } from "./useMapFocusedNeighbors";
import { useMapBorders } from "./useMapBorders";
import { useMapBordersData } from "./useMapBordersData";
import { useMapPacketFlow } from "./useMapPacketFlow";
import { PacketFlowButton } from "./PacketFlowButton";
import { LivePacketFeed } from "./LivePacketFeed";
import { useMapNodesData } from "./useMapNodesData";
import { nodesToFeatureCollection, filterByNodeType, buildNeighborEdges, buildFocusedNeighborEdges, buildFocusedNeighborPoints, buildFocusedSelectedPoint, neighborRenderMode, type NeighborEdgeProps } from "./node-geojson";
import { MapSettingsPanel } from "./MapSettingsPanel";
import { buildMapParams, type MapViewSnapshot, type ParsedMapView } from "./map-url";
import { MAP_BORDERS_STORAGE_KEY, mapStyleForTheme, resolveMapStyle, MAP_NEIGHBOR_LINES_STORAGE_KEY, MAP_CLUSTER_STORAGE_KEY, MAP_NODE_TYPE_STORAGE_KEY, DEFAULT_CENTER, DEFAULT_ZOOM, type NeighborLinesMode } from "./types";
import type { FeatureCollection, LineString } from "geojson";
import { EmptyState } from "../../components/EmptyState";
import { LoadingPill } from "../../components/LoadingPill";
import { useRegion } from "../../hooks/useRegion";
import { useTheme } from "../../hooks/useTheme";
import { iataQueries, nodeQueries } from "../../api/queries";
import type { WsManager } from "../../api/ws-manager";

const EMPTY_EDGES: FeatureCollection<LineString, NeighborEdgeProps> = { type: "FeatureCollection", features: [] };

interface MapViewProps {
  wsManager: WsManager;
  // shared with the Nodes tab (lifted to the nodes route) so the open NodeDetailPanel stays live
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onOpenPacket: (packetHash: string) => void;
  // validated /map search params, parsed by the router (parseMapViewSearch)
  urlView: ParsedMapView;
}

export function MapView({ wsManager, selectedNodeId, onSelectNode, onOpenPacket, urlView }: MapViewProps) {
  const { t } = useTranslation();
  // Deep-link params, read once at mount (like the region's ?iata seed). Each setting below is seeded
  // URL -> localStorage -> default; the URL wins for this session but is never written back to
  // localStorage, so a shared link can't clobber the visitor's saved prefs.

  const [typeFilter, setTypeFilter] = useState(
    () => urlView.nodeType ?? localStorage.getItem(MAP_NODE_TYPE_STORAGE_KEY) ?? "",
  ); // "" = All
  const handleTypeChange = useCallback((t: string) => {
    setTypeFilter(t);
    localStorage.setItem(MAP_NODE_TYPE_STORAGE_KEY, t);
  }, []);

  const [clustered, setClustered] = useState(
    () => urlView.clustered ?? localStorage.getItem(MAP_CLUSTER_STORAGE_KEY) !== "off",
  );
  const handleClusteredChange = useCallback((c: boolean) => {
    setClustered(c);
    localStorage.setItem(MAP_CLUSTER_STORAGE_KEY, c ? "on" : "off");
  }, []);

  const [neighborLines, setNeighborLines] = useState<NeighborLinesMode>(() => {
    if (urlView.neighborLines) return urlView.neighborLines;
    const stored = localStorage.getItem(MAP_NEIGHBOR_LINES_STORAGE_KEY);
    return stored === "on" || stored === "selected" || stored === "off" ? stored : "selected";
  });
  const handleNeighborLinesChange = useCallback((mode: NeighborLinesMode) => {
    setNeighborLines(mode);
    localStorage.setItem(MAP_NEIGHBOR_LINES_STORAGE_KEY, mode);
  }, []);

  // live packet-flow animation: opt-in per session (off by default, not persisted; a deep link can seed it)
  const [packetFlow, setPacketFlow] = useState(() => urlView.flow ?? false);
  const [packetFlowSession, setPacketFlowSession] = useState(0);

  // IATA region borders overlay, on by default (outline only); seeded URL -> localStorage so an
  // explicit "off" sticks, like the other toggles
  const [borders, setBorders] = useState(
    () => urlView.borders ?? localStorage.getItem(MAP_BORDERS_STORAGE_KEY) !== "off",
  );
  const handleBordersChange = useCallback((on: boolean) => {
    setBorders(on);
    localStorage.setItem(MAP_BORDERS_STORAGE_KEY, on ? "on" : "off");
  }, []);

  // A deep-link camera opens the map here and suppresses the initial region fit (see useMapLibre).
  const initialCamera = useMemo(
    () => (urlView.center ? { center: urlView.center, zoom: urlView.zoom ?? DEFAULT_ZOOM } : undefined),
    [urlView],
  );

  const { iatas: selectedIatas, regionKey } = useRegion();
  // marker/cluster icons are canvas-drawn from the active --palette-* vars, so useMapNodes has to
  // re-register them whenever the palette changes: on a theme switch, and once on load when the async
  // themes populate (from [] -> filled).
  const { themeId, themes } = useTheme();
  const themeKey = themes.length ? themeId : "";
  // The basemap follows the app theme (Meshat Dark → dark tiles, Meshat Light → light tiles); a
  // ?style= deep link still wins for the session. Nothing is persisted — switching theme swaps tiles.
  const styleId = urlView.styleId ?? mapStyleForTheme(themeId);
  const { data: iatas } = useQuery(iataQueries.list());

  // nodes for the selected region (its own key, independent of the Nodes-table filters/page cap).
  // Pages in 50 at a time so the map fills batch by batch.
  const { nodes, loadedCount, isPaging, isError: nodesError } = useMapNodesData(selectedIatas, regionKey);



  // split memos: rebuild the FeatureCollection only when nodes change; a type-filter change just
  // re-filters the already-built collection instead of re-running the full transform over all nodes
  const baseFc = useMemo(() => nodesToFeatureCollection(nodes), [nodes]);
  const geojson = useMemo(() => filterByNodeType(baseFc, typeFilter), [baseFc, typeFilter]);

  // Selected mode colours the one node's edges by observation count + freshness, which only the node
  // detail endpoint carries (the list's neighborIds are bare uuids). Shares the panel's query cache
  // (same key), so selecting a node — which opens the panel — usually has this already warm.
  const focusEnabled = neighborLines !== "off" && !!selectedNodeId;
  const { data: focusNeighbors } = useQuery({
    ...nodeQueries.neighbors(selectedNodeId ?? ""),
    enabled: focusEnabled,
  });
  // A focused neighbor can sit outside the current region/list page. Reuse the detail-panel query so
  // its coordinates remain available after selection instead of letting the next edge set collapse.
  const { data: selectedNodeDetail } = useQuery({
    ...nodeQueries.detail(selectedNodeId ?? ""),
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
    if (renderMode === "off") return EMPTY_EDGES;
    if (renderMode === "focused") {
      return buildFocusedNeighborEdges(selectedNodeForFocus, focusNeighbors ?? []);
    }
    return buildNeighborEdges(nodes, "on", null);
  }, [nodes, neighborLines, selectedNodeId, selectedNodeForFocus, focusNeighbors, packetFlow]);
  const focusedNeighborPoints = useMemo(
    () => selectedNodeId && neighborLines !== "off" ? {
      type: "FeatureCollection" as const,
      features: [
        ...buildFocusedSelectedPoint(selectedNodeForFocus).features,
        ...buildFocusedNeighborPoints(selectedNodeId, focusNeighbors ?? []).features,
      ],
    } : { type: "FeatureCollection" as const, features: [] },
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
    return selectedIatas && selectedIatas.length > 0 ? all.filter((c) => selectedIatas.includes(c)) : all;
  }, [iatas, selectedIatas]);
  const borderData = useMapBordersData(borderIatas, borders);

  // No onStyleError handler: with the style derived from the theme there's no alternate selection to
  // revert to — useMapLibre still pins its internal last-good style so a failed swap keeps rendering.
  const { containerRef, mapRef, isReady, styleRevision, error } = useMapLibre(styleId, fitPoints, undefined, initialCamera);
  const isDark = resolveMapStyle(styleId).dark; // drives marker theming + maplibre control chrome
  const mapThemeKey = `${themeKey}:${styleRevision}`;

  // A selected-node deep link should open at inspection scale even when the node sits outside the
  // currently loaded region. The same restrained move also helps when following a focused neighbor.
  const lastFocusedNodeRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || !selectedNodeId || !selectedNodeForFocus) return;
    if (selectedNodeForFocus.lng == null || selectedNodeForFocus.lat == null) return;
    if (lastFocusedNodeRef.current === selectedNodeId) return;
    lastFocusedNodeRef.current = selectedNodeId;
    map.flyTo({
      center: [selectedNodeForFocus.lng, selectedNodeForFocus.lat],
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
    container.classList.remove("map-presentation-transition");
    void container.offsetWidth;
    container.classList.add("map-presentation-transition");
    const timer = window.setTimeout(() => container.classList.remove("map-presentation-transition"), 280);
    return () => window.clearTimeout(timer);
  }, [mapRef, presentationKey]);

  // Snapshot the current view (live camera + settings) into deep-link params for the copy button.
  // Evaluated at click, so it reads the real camera. The current route is already /map.
  const buildShareParams = useCallback((): Record<string, string | null> => {
    const map = mapRef.current;
    const center = map?.getCenter();
    const snapshot: MapViewSnapshot = {
      center: center ? [center.lng, center.lat] : DEFAULT_CENTER,
      zoom: map?.getZoom() ?? DEFAULT_ZOOM,
      clustered,
      nodeType: typeFilter,
      neighborLines,
      styleId,
      flow: packetFlow,
      borders,
    };
    return buildMapParams(snapshot);
  }, [mapRef, clustered, typeFilter, neighborLines, styleId, packetFlow, borders]);

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
  useMapFocusedNeighbors(mapRef, isReady, focusedNeighborPoints, packetFlow, mapThemeKey, onSelectNode);
  useMapBorders(mapRef, isReady, borderData, mapThemeKey);
  useMapPacketFlow(mapRef, isReady, packetFlow, wsManager, mapThemeKey, regionKey);

  return (
    <div className="relative flex flex-1 min-h-0">
      {/* Fill via flex-1, NOT absolute inset-0: maplibre adds .maplibregl-map { position: relative }
          to this element, which overrides Tailwind's `absolute` and would collapse inset-0 to 0
          height. data-dark drives the maplibre control theming in index.css. */}
      <div ref={containerRef} data-dark={isDark} className="flex-1" />
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
        buildShareParams={buildShareParams}
      />
      <PacketFlowButton
        active={packetFlow}
        onToggle={() => {
          if (!packetFlow) setPacketFlowSession((session) => session + 1);
          setPacketFlow((value) => !value);
        }}
      />
      <LivePacketFeed
        active={packetFlow}
        resetKey={`${regionKey}:${packetFlowSession}`}
        selectedIatas={selectedIatas}
        wsManager={wsManager}
        onOpenPacket={onOpenPacket}
      />
      {/* streams in 50 at a time; the count climbs as pages land, then the pill disappears */}
      <LoadingPill loading={isPaging} error={nodesError} count={loadedCount} noun={t("entities.nodes")} />
      {error && (
        // z-20 so the failure overlay covers the settings card (z-10) instead of it floating on top
        <div className="absolute inset-0 z-20 bg-bg-base">
          <EmptyState title={t("map.failed")} subtitle={t("map.failedHint")} />
        </div>
      )}
    </div>
  );
}
