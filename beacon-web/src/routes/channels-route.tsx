import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChannelList, type ChannelListViewState } from "../features/channels/ChannelList";
import type { ChannelHashtagFilter, ChannelKeyFilter } from "../features/channels/channel-filters";
import { wsManager } from "../api/ws-instance";
import { useOverlays } from "./overlays";

function channelViewState(search: ReturnType<typeof useSearch>): ChannelListViewState {
  const s = search as Record<string, unknown>;
  return {
    search: typeof s.cq === "string" ? s.cq : "",
    searchField: s.csf === "hash" ? "hash" : "name",
    keyFilter: (s.ck === "known" || s.ck === "unknown" ? s.ck : "") as ChannelKeyFilter,
    hashtagFilter: (s.ch === "true" || s.ch === "false" ? s.ch : "") as ChannelHashtagFilter,
  };
}

export function ChannelsRoute() {
  const search = useSearch({ from: "/channels" });
  const navigate = useNavigate({ from: "/channels" });
  const overlays = useOverlays();
  const viewState = useMemo(() => channelViewState(search), [search]);
  const onViewStateChange = useCallback((patch: Partial<ChannelListViewState>, options?: { replace?: boolean }) => {
    navigate({
      to: ".",
      replace: options?.replace,
      search: (prev) => ({
        ...prev,
        ...(patch.search !== undefined ? { cq: patch.search || undefined } : {}),
        ...(patch.searchField !== undefined ? { csf: (patch.searchField === "name" ? undefined : patch.searchField) as "hash" | undefined } : {}),
        ...(patch.keyFilter !== undefined ? { ck: patch.keyFilter || undefined } : {}),
        ...(patch.hashtagFilter !== undefined ? { ch: patch.hashtagFilter || undefined } : {}),
      }),
    });
  }, [navigate]);

  return (
    <ChannelList
      wsManager={wsManager}
      onAnalyze={overlays.analyze}
      viewState={viewState}
      onViewStateChange={onViewStateChange}
    />
  );
}
