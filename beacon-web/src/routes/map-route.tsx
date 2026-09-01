import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MapView } from "../features/map/MapView";
import { NodeDetailPanel } from "../features/nodes/NodeDetailPanel";
import { parseMapViewSearch } from "../features/map/map-url";
import { wsManager } from "../api/ws-instance";
import { useOverlays } from "./overlays";

export function MapRoute() {
  const search = useSearch({ from: "/map" });
  const overlays = useOverlays();
  const navigate = useNavigate({ from: "/map" });
  const urlView = parseMapViewSearch(search);
  const selectMapNode = useCallback((id: string | null) => {
    navigate({ to: ".", search: (prev) => ({ ...prev, node: id ?? undefined }) });
  }, [navigate]);

  return (
    <>
      <MapView
        key={JSON.stringify(urlView)}
        wsManager={wsManager}
        urlView={urlView}
        selectedNodeId={search.node ?? null}
        onSelectNode={selectMapNode}
        onOpenPacket={overlays.setOverlayPacketHash}
      />
      {search.node && (
        <NodeDetailPanel
          nodeId={search.node}
          onClose={() => selectMapNode(null)}
          onViewObserver={overlays.selectObserver}
          onViewNode={selectMapNode}
          onAnalyzePacket={overlays.setOverlayPacketHash}
        />
      )}
    </>
  );
}
