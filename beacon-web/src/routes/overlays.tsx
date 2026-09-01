import { createContext, useContext } from "react";
import type { PacketDetail } from "../types/api";

export interface Overlays {
  overlayPacketHash: string | null;
  setOverlayPacketHash: (hash: string | null) => void;
  overlayNodeId: string | null;
  setOverlayNodeId: (id: string | null) => void;
  pathMapDetail: PacketDetail | null;
  openPath: (detail: PacketDetail, initialKey: string | null) => void;
  selectedObservationId: number | null;
  setSelectedObservationId: (id: number | null) => void;
  analyze: (hash: string | null) => void;
  selectNode: (id: string | null) => void;
  selectObserver: (id: string | null) => void;
  viewObserverStats: (observerId: string) => void;
}

export const OverlaysContext = createContext<Overlays | null>(null);

export function useOverlays(): Overlays {
  const ctx = useContext(OverlaysContext);
  if (!ctx) throw new Error("useOverlays must be used within the route tree");
  return ctx;
}
