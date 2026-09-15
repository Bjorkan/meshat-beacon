import type { NeighborInteractionHandler } from '../features/nodes/NodeNeighborRow';
import { useCallback, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { MapView } from '../features/map/MapView';
import { NodeDetailPanel } from '../features/nodes/NodeDetailPanel';
import { parseMapViewSearch } from '../features/map/map-url';
import { wsManager } from '../api/ws-instance';
import { useOverlays } from './overlays';

export function MapRoute() {
  const search = useSearch({ from: '/map' });
  const overlays = useOverlays();
  const navigate = useNavigate({ from: '/map' });
  const urlView = parseMapViewSearch(search);
  const selectedNodeId = search.node ?? null;
  const [inspection, setInspection] = useState({
    nodeId: selectedNodeId,
    pointer: null as string | null,
    focus: null as string | null,
  });
  if (inspection.nodeId !== selectedNodeId) {
    setInspection({ nodeId: selectedNodeId, pointer: null, focus: null });
  }
  const onNeighborInteraction = useCallback<NeighborInteractionHandler>(
    (id, source, active) => {
      setInspection((current) => {
        if (current.nodeId !== selectedNodeId) return current;
        return {
          ...current,
          [source]: active ? id : current[source] === id ? null : current[source],
        };
      });
    },
    [selectedNodeId],
  );
  const hoveredNeighborId =
    inspection.nodeId === selectedNodeId ? (inspection.pointer ?? inspection.focus) : null;

  const selectMapNode = useCallback(
    (id: string | null) => {
      navigate({ to: '.', search: (prev) => ({ ...prev, node: id ?? undefined }) });
    },
    [navigate],
  );

  return (
    <>
      <MapView
        key={JSON.stringify(urlView)}
        wsManager={wsManager}
        urlView={urlView}
        selectedNodeId={selectedNodeId}
        hoveredNeighborId={hoveredNeighborId}
        onSelectNode={selectMapNode}
        onOpenPacket={overlays.openPacket}
      />
      {search.node && (
        <NodeDetailPanel
          key={search.node}
          onNeighborInteraction={onNeighborInteraction}
          nodeId={search.node}
          onClose={() => selectMapNode(null)}
          onViewObserver={overlays.selectObserver}
          onViewNode={selectMapNode}
          onAnalyzePacket={overlays.openPacket}
        />
      )}{' '}
    </>
  );
}
