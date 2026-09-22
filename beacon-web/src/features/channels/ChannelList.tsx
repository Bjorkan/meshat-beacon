import { useTranslation } from 'react-i18next';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { channelQueries } from '../../api/queries';
import { useRegion } from '../../hooks/useRegion';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useWsChannelMessageHandler } from '../../hooks/useWsHandlers';
import { SkeletonRows } from '../../components/SkeletonRows';
import { ChannelSidebar } from './ChannelSidebar';
import { ChannelFilterBar } from './ChannelFilterBar';
import { MessagePanel } from './MessagePanel';
import {
  filterChannels,
  type ChannelKeyFilter,
  type ChannelHashtagFilter,
} from './channel-filters';
import type { ChannelMessage } from './types';
import type { WsManager } from '../../api/ws-manager';

export interface ChannelListViewState {
  search: string;
  searchField: string;
  keyFilter: ChannelKeyFilter;
  hashtagFilter: ChannelHashtagFilter;
}

interface ChannelListProps {
  selectedChannelId?: number;
  targetMessageHash?: string;
  onSelectedChannelChange?: (id: number | null) => void;
  wsManager: WsManager;
  onAnalyze: (hash: string | null) => void;
  viewState: ChannelListViewState;
  onViewStateChange: (
    patch: Partial<ChannelListViewState>,
    options?: { replace?: boolean },
  ) => void;
}

export function ChannelList({
  wsManager,
  onAnalyze,
  viewState,
  onViewStateChange,
  selectedChannelId,
  targetMessageHash,
  onSelectedChannelChange,
}: ChannelListProps) {
  const { t } = useTranslation();
  const { iatas, regionKey } = useRegion();
  const isMobile = useIsMobile();
  const [localSelectedId, setSelectedId] = useState<number | null>(null);
  const selectedId = onSelectedChannelChange ? (selectedChannelId ?? null) : localSelectedId;
  const [heardCounts, setHeardCounts] = useState<Record<string, number>>({});
  const { search, searchField, keyFilter, hashtagFilter } = viewState;

  const prevRegion = useRef(regionKey);
  useEffect(() => {
    if (prevRegion.current !== regionKey) {
      prevRegion.current = regionKey;
      setSelectedId(null);
      // A linked message must survive asynchronous expansion of the initial region.
      if (!targetMessageHash) onSelectedChannelChange?.(null);
      setHeardCounts({});
    }
  }, [regionKey, onSelectedChannelChange, targetMessageHash]);

  const handleSelect = useCallback(
    (id: number | null) => {
      setSelectedId(id);
      onSelectedChannelChange?.(id);
      setHeardCounts({});
    },
    [onSelectedChannelChange],
  );

  const hash =
    searchField === 'hash' && /^[0-9a-f]{2}$/i.test(search.trim())
      ? search.trim().toLowerCase()
      : undefined;
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(channelQueries.list({ regionKey, iatas, hash, key: keyFilter || undefined }));
  const channels = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const showUnknownSummary = !keyFilter && !search.trim() && !hashtagFilter;
  const unknownCount = showUnknownSummary ? (data?.pages[0]?.unknownCount ?? 0) : 0;

  // Public pinned first, then named channels, then unnamed by most recent.
  const sortedChannels = useMemo(
    () =>
      [...(channels ?? [])].sort((a, b) => {
        const aPub = a.kind === 'public' ? 1 : 0;
        const bPub = b.kind === 'public' ? 1 : 0;
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

  const listedChannel = sortedChannels.find((ch) => ch.id === selectedId);
  const selectedDetail = useQuery({
    ...channelQueries.detail(selectedId ?? undefined),
    enabled: selectedId !== null && !listedChannel,
  });

  // resolve against the full list so a selected channel keeps showing even when filtered out
  const selectedChannel = listedChannel ?? selectedDetail.data ?? null;

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
          onSearchFieldChange={(value) => onViewStateChange({ searchField: value, search: '' })}
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
                unknownCount={unknownCount}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
            {isError && (
              <button type="button" className="p-3 text-xs text-red" onClick={() => void refetch()}>
                {t('common.failedToLoad')} · {t('common.tryAgain')}
              </button>
            )}
            {hasNextPage && (
              <button
                type="button"
                className="p-3 text-xs text-primary"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {t(isFetchingNextPage ? 'common.loading' : 'common.loadMore')}
              </button>
            )}
          </div>
        )}
        {selectedId !== null && selectedDetail.isError && !selectedChannel ? (
          <button
            type="button"
            className="p-3 text-xs text-red"
            onClick={() => void selectedDetail.refetch()}
          >
            {t('common.failedToLoad')} · {t('common.tryAgain')}
          </button>
        ) : selectedId !== null && !selectedChannel ? (
          <div className="p-3 text-xs text-text-muted">{t('common.loading')}</div>
        ) : (
          (!isMobile || selectedChannel !== null) && (
            <MessagePanel
              channel={selectedChannel}
              suggestedChannel={filteredChannels[0]}
              onSelectChannel={handleSelect}
              heardCounts={heardCounts}
              iatas={iatas}
              regionKey={regionKey}
              onAnalyze={onAnalyze}
              onBack={isMobile ? () => handleSelect(null) : undefined}
              targetMessageHash={targetMessageHash}
            />
          )
        )}
      </div>
    </div>
  );
}
