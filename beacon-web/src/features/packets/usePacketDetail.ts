import { useQuery } from "@tanstack/react-query";
import { packetQueries } from "../../api/queries";

// One query per hash shared by the expanded row, the analyzer drawer and the overlay — TanStack
// dedupes, so a row expanded under an open drawer costs a single request. The short staleTime is
// deliberate: observations keep accruing, so reopening should show them rather than the snapshot
// frozen at first open.
export function usePacketDetail(hash: string | null) {
  return useQuery(packetQueries.detail(hash));
}
