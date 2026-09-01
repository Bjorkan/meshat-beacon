import { PacketList } from "../features/packets/PacketList";
import { wsManager } from "../api/ws-instance";
import { useOverlays } from "./overlays";

export function PacketsRoute() {
  const overlays = useOverlays();
  return (
    <PacketList
      wsManager={wsManager}
      onAnalyze={overlays.analyze}
      onViewPath={(detail) => overlays.openPath(detail, null)}
      selectedObservationId={overlays.selectedObservationId}
      onSelectObservation={overlays.setSelectedObservationId}
    />
  );
}
