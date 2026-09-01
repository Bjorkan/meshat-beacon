import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { channelQueries } from "../../api/queries";
import { useRegion } from "../../hooks/useRegion";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useWsChannelMessageHandler } from "../../hooks/useWsHandlers";
import { SkeletonRows } from "../../components/SkeletonRows";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChannelFilterBar } from "./ChannelFilterBar";
import { MessagePanel } from "./MessagePanel";
import { filterChannels, type ChannelKeyFilter, type ChannelHashtagFilter } from "./channel-filters";
import type { ChannelMessage } from "./types";
import type { WsManager } from "../../api/ws-manager";

export interface ChannelListViewState {
  search: string;
  searchField: string;
  keyFilter: ChannelKeyFilter;
  hashtagFilter: ChannelHashtagFilter;
}

interface ChannelListProps {
  wsManager: WsManager;
  onAnalyze: (hash: string | null) => void;
  viewState: ChannelListViewState;
  onViewStateChange: (patch: Partial<ChannelListViewState>, options?: { replace?: boolean }) => void;
}

export function ChannelList({ wsManager, onAnalyze, viewState, onViewStateChange }: ChannelListProps) {
  const { iatas, regionKey } = useRegion();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [heardCounts, setHeardCounts] = useState<Record<string, number>>({});
  const { search, searchField, keyFilter, hashtagFilter } = viewState;

  const prevRegion = useRef(regionKey);
  useEffect(() => {
    if (prevRegion.current !== regionKey) {
      prevRegion.current = regionKey;
      setSelectedId(null);
      setHeardCounts({});
    }
  }, [regionKey]);

  const handleSelect = useCallback((id: number) => {
    setSelectedId(id);
    setHeardCounts({});
  }, []);

  const { data: channels, isLoading } = useQuery(channelQueries.list({ regionKey, iatas }));

  // "Public" pinned first, then named channels, then unnamed by most recent
  const sortedChannels = useMemo(
    () =>
      [...(channels ?? [])].sort((a, b) => {
        const aPub = a.name === "Public" ? 1 : 0;
        const bPub = b.name === "Public" ? 1 : 0;
        if (aPub !== bPub) return bPub - aPub;
        if (a.name && !b.name) return -1;
        if (!a.name && b.name) return 1;
        return b.lastSeen - a.lastSeen;
      }),
    [channels],
  );

  const filteredChannels = useMemo(
    () => filterChannels(sortedChannels, { search, searchField, keyFilter, hashtagFilter }),
    [sortedChannels, search, searchField, keyFilter, hashtagFilter],
  );

  // resolve against the full list so a selected channel keeps showing even when filtered out
  const selectedChannel = sortedChannels.find((ch) => ch.id === selectedId) ?? null;

  const handleChannelMessage = useCallback(
    (data: ChannelMessage) => {
      // Shared channel/message Query caches are synchronized by QueryWsBridge. This route-owned
      // listener only tracks ephemeral reach for the thread currently on screen.
      if (selectedChannel && data.channelHash === selectedChannel.channelHash) {
        setHeardCounts((prev) => ({
          ...prev,
          [data.packetHash]: (prev[data.packetHash] ?? 0) + 1,
        }));
      }
    },
    [selectedChannel],
  );

  useWsChannelMessageHandler(wsManager, handleChannelMessage);

  // mobile: opening a thread takes over the whole view, hiding the list and filter bar
  const showList = !isMobile || selectedChannel === null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showList && (
        <ChannelFilterBar
          search={search}
          onSearchChange={(value) => onViewStateChange({ search: value }, { replace: true })}
          searchField={searchField}
          onSearchFieldChange={(value) => onViewStateChange({ searchField: value, search: "" })}
          keyFilter={keyFilter}
          onKeyChange={(value) => onViewStateChange({ keyFilter: value })}
          hashtagFilter={hashtagFilter}
          onHashtagChange={(value) => onViewStateChange({ hashtagFilter: value })}
        />
      )}
      <div className="flex flex-1 min-h-0">
        {showList && (
          <div className="flex flex-col min-h-0 w-full lg:w-56 lg:min-w-56 border-r border-border bg-bg-surface">
            {isLoading ? (
              <SkeletonRows rows={8} />
            ) : (
              <ChannelSidebar
                channels={filteredChannels}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
          </div>
        )}
        {(!isMobile || selectedChannel !== null) && (
          <MessagePanel
            channel={selectedChannel}
            heardCounts={heardCounts}
            iatas={iatas}
            regionKey={regionKey}
            onAnalyze={onAnalyze}
            onBack={isMobile ? () => setSelectedId(null) : undefined}
          />
        )}
      </div>
    </div>
  );
}
