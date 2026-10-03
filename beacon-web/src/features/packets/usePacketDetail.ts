import { useQuery } from "@tanstack/react-query";
import { getPacketDetail } from "../../api/client";
import type { PacketDetail } from "../../types/api";

// One query per hash shared by the expanded row, the analyzer drawer and the overlay — TanStack
// dedupes, so a row expanded under an open drawer costs a single request. The short staleTime is
// deliberate: observations keep accruing, so reopening should show them rather than the snapshot
// frozen at first open.
export function usePacketDetail(hash: string | null) {
  return useQuery<PacketDetail>({
    queryKey: ["packet-detail", hash],
    queryFn: () => getPacketDetail(hash!),
    enabled: !!hash,
    staleTime: 30_000,
  });
}
