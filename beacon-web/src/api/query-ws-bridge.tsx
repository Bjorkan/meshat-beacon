import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRegion } from "../hooks/useRegion";
import { statsQueries } from "./queries";
import { wsManager } from "./ws-instance";
import { healLiveQueryCaches, syncChannelMessage, syncNodeUpdate, syncObserverStatus, syncPacketObservation } from "./query-ws-sync";
import type { StatsOverview } from "../features/stats/types";

// One app-lifetime bridge owns shared REST-cache coherence. Feature components may still subscribe to
// WS events for ephemeral presentation (packet animation, live banners, reach counters), but not to
// keep TanStack Query's shared server state correct.
export function QueryWsBridge() {
  const queryClient = useQueryClient();
  const { regionKey } = useRegion();
  const statsPending = useRef({ packets: 0, observations: 0, raf: null as number | null });

  useEffect(() => {
    const pending = statsPending.current;
    const flushStats = () => {
      pending.raf = null;
      if (!pending.packets && !pending.observations) return;
      const key = statsQueries.overview(regionKey).queryKey;
      queryClient.setQueryData<StatsOverview>(key, (old) => old ? {
        ...old,
        totalPackets: old.totalPackets + pending.packets,
        totalObservations: old.totalObservations + pending.observations,
      } : old);
      pending.packets = 0;
      pending.observations = 0;
    };

    const offPacket = wsManager.onPacketObservation((data) => {
      syncPacketObservation(queryClient, data);
      pending.observations += 1;
      if (data.packet.isFirstObservation) pending.packets += 1;
      if (pending.raf == null) pending.raf = requestAnimationFrame(flushStats);
    });
    const offNode = wsManager.onNodeUpdate((data) => syncNodeUpdate(queryClient, data));
    const offObserver = wsManager.onObserverStatus((data) => syncObserverStatus(queryClient, data));
    const offChannel = wsManager.onChannelMessage((data) => syncChannelMessage(queryClient, data, regionKey));
    const offLagged = wsManager.onLagged(() => healLiveQueryCaches(queryClient));

    return () => {
      offPacket(); offNode(); offObserver(); offChannel(); offLagged();
      if (pending.raf != null) cancelAnimationFrame(pending.raf);
    };
  }, [queryClient, regionKey]);

  // Events are intentionally scoped to the current region. Caches for the region we just left cannot
  // receive subsequent events, so mark every live family stale at the boundary instead of pretending
  // those inactive snapshots remain authoritative forever.
  const previousRegion = useRef(regionKey);
  useEffect(() => {
    if (previousRegion.current === regionKey) return;
    previousRegion.current = regionKey;
    statsPending.current.packets = 0;
    statsPending.current.observations = 0;
    healLiveQueryCaches(queryClient);
  }, [queryClient, regionKey]);

  return null;
}
