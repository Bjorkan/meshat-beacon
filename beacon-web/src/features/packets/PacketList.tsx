import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { usePackets } from "./usePackets";
import { usePacketDetail } from "./usePacketDetail";
import { usePacketFilters, matchesFilters, toServerFilter } from "./usePacketFilters";
import { useScopes } from "../../hooks/useScopes";
import { useRegion } from "../../hooks/useRegion";
import { useWsPacketHandler, useWsLaggedHandler } from "../../hooks/useWsHandlers";
import { PacketVirtualList } from "./PacketVirtualList";
import { FilterBar } from "../../components/FilterBar";
import { LoadingPill } from "../../components/LoadingPill";
import { SkeletonRows } from "../../components/SkeletonRows";
import { PAYLOAD_TYPE_NAMES, ROUTE_TYPE_NAMES } from "../../types/enums";
import type { WsManager } from "../../api/ws-manager";
import type { PacketDetail, PacketSummary } from "../../types/api";
import type { WsPacketObservation } from "../../types/ws";

// filter options and storage keys

const TYPE_OPTIONS = Object.entries(PAYLOAD_TYPE_NAMES).map(([value, label]) => ({
  value: String(value),
  label,
}));

const ROUTE_OPTIONS = Object.entries(ROUTE_TYPE_NAMES).map(([value, label]) => ({
  value: String(value),
  label,
}));

interface PacketListProps {
  wsManager: WsManager;
  onAnalyze: (hash: string | null) => void;
  onViewPath: (detail: PacketDetail) => void;
  selectedObservationId: number | null;
  onSelectObservation: (id: number) => void;
}

function summaryFromDetail(detail: PacketDetail): PacketSummary {
  const latest = detail.observations.reduce<(typeof detail.observations)[number] | undefined>(
    (current, observation) => !current || observation.heardAt > current.heardAt ? observation : current,
    undefined,
  );

  return {
    packetHash: detail.packetHash,
    payloadType: detail.header.payloadType,
    payloadTypeName: detail.header.payloadTypeName,
    routeType: detail.header.routeType,
    routeTypeName: detail.header.routeTypeName,
    firstHeardAt: detail.firstHeardAt,
    lastHeardAt: detail.lastHeardAt,
    observationCount: detail.observationCount,
    scope: detail.scope,
    latestObserver: latest ? {
      id: latest.observerId,
      displayName: latest.observerName,
      iata: latest.iata,
      pathLength: latest.pathLength,
      pathBytes: latest.pathBytes,
      resolvedPath: latest.resolvedPath,
      resolvedSource: latest.resolvedSource,
      resolvedDestination: latest.resolvedDestination,
    } : undefined,
  };
}

// main packet view: filters, banner, virtual list

export function PacketList({ wsManager, onAnalyze, onViewPath, selectedObservationId, onSelectObservation }: PacketListProps) {
  const { t } = useTranslation();
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const { filters, setFilter, setSearch, setSearchField, clearFilters } = usePacketFilters();
  // single-value selections go to the server so scrolling pages through matching history
  const serverFilter = useMemo(() => toServerFilter(filters), [filters]);
  const scopeNames = useScopes();
  const scopeOptions = useMemo(() => scopeNames.map((s) => ({ value: s, label: s })), [scopeNames]);
  const { regionKey } = useRegion();

  // isAtTop drives the freeze (list held static while scrolled off the very top); isScrolledAway
  // (a wider deadband) drives the banner. listResetKey remounts the list to reveal held packets.
  const [isScrolledAway, setIsScrolledAway] = useState(false);
  const [isAtTop, setIsAtTop] = useState(true);
  const [listResetKey, setListResetKey] = useState(0);

  const {
    allPackets,
    observerOptions,
    newPacketCount,
    acknowledgeNewPackets,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    observersByHash,
    handlePacketObservation,
    handleLagged,
    laggedCount,
    dismissLagged,
  } = usePackets(!isAtTop, serverFilter);

  // ?hash is the selected packet — it expands the row inline. The analyzer is a separate state (?analyze=1).
  const expandedHash = search.hash ?? null;

  // Shared with the expanded row's own usePacketDetail, so reading it here costs no extra request.
  const { data: expandedDetail } = usePacketDetail(expandedHash);

  const packets = useMemo(() => {
    const matching = allPackets.filter((p) => matchesFilters(p, filters, observersByHash));
    if (!expandedDetail || matching.some((packet) => packet.packetHash === expandedDetail.packetHash)) {
      return matching;
    }

    // A deep-linked packet can have aged out of the first history page. Keep the URL contract by
    // materializing the already-fetched detail as one list row; PacketExpansion reuses its query.
    return [summaryFromDetail(expandedDetail), ...matching];
  }, [allPackets, expandedDetail, filters, observersByHash]);

  const handleToggleExpand = useCallback((hash: string) => {
    const next = expandedHash === hash ? null : hash;
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => {
        const n = { ...prev };
        if (next) n.hash = next; else n.hash = undefined;
        return n;
      },
      replace: true,
    });
  }, [expandedHash, navigate]);

  const handleOpenAnalyzer = useCallback(() => {
    if (expandedHash) onAnalyze(expandedHash);
  }, [expandedHash, onAnalyze]);

  const handleViewPath = useCallback(() => {
    if (expandedDetail) onViewPath(expandedDetail);
  }, [expandedDetail, onViewPath]);

  // Shared packet-detail cache invalidation lives in QueryWsBridge. This route listener only feeds
  // the ephemeral live buffer used by the scrolling packet UX.
  const handleObservation = useCallback((data: WsPacketObservation["data"]) => {
    handlePacketObservation(data);
  }, [handlePacketObservation]);

  useWsPacketHandler(wsManager, handleObservation);
  useWsLaggedHandler(wsManager, handleLagged);

  // Keep live rows at parity with the REST list's include=resolvedPath enrichment while this view is
  // mounted. Other tabs leave the connection on its cheaper default unless they explicitly need it.
  useEffect(() => {
    wsManager.setResolvePath(true);
    return () => wsManager.setResolvePath(false);
  }, [wsManager]);

  const bannerCount = isScrolledAway ? newPacketCount : 0;

  // Remount the list (fresh at the top, no stale scroll anchor for the virtualizer to preserve)
  // when returning to the top with packets held while away — a big prepend into the live list
  // would otherwise keep the old row anchored instead of landing on the newest.
  const [prevAtTop, setPrevAtTop] = useState(isAtTop);
  if (prevAtTop !== isAtTop) {
    setPrevAtTop(isAtTop);
    if (isAtTop && newPacketCount > 0) setListResetKey((k) => k + 1);
  }

  // A region switch starts fresh at the top so the new region's list isn't held frozen.
  const [prevRegionKey, setPrevRegionKey] = useState(regionKey);
  if (prevRegionKey !== regionKey) {
    setPrevRegionKey(regionKey);
    setListResetKey((k) => k + 1);
    setIsAtTop(true);
    setIsScrolledAway(false);
  }

  // At the top the held packets are revealed, so acknowledge continuously there — the banner then
  // counts only what arrived while the user was away (and never flashes a count at the top).
  useEffect(() => {
    if (isAtTop && newPacketCount > 0) acknowledgeNewPackets();
  }, [isAtTop, newPacketCount, acknowledgeNewPackets]);

  // Returning to the top (revealing held packets) is a remount; releasing the freeze first lets
  // the fresh list mount with the newest packet already in place.
  const handleScrollToTop = useCallback(() => {
    setIsScrolledAway(false);
    setIsAtTop(true);
  }, []);

  return (
    <div className="flex flex-1 min-h-0">
      <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
        <FilterBar
          typeOptions={TYPE_OPTIONS}
          routeOptions={ROUTE_OPTIONS}
          observerOptions={observerOptions}
          scopeOptions={scopeOptions}
          activeTypes={filters.payloadTypes.map(String)}
          activeRoutes={filters.routeTypes.map(String)}
          activeObservers={filters.observers}
          activeScopes={filters.scopes}
          onTypesChange={(v) => setFilter("payloadTypes", v.map(Number))}
          onRoutesChange={(v) => setFilter("routeTypes", v.map(Number))}
          onObserversChange={(v) => setFilter("observers", v)}
          onScopesChange={(v) => setFilter("scopes", v)}
          search={filters.search}
          onSearchChange={setSearch}
          searchField={filters.searchField}
          onSearchFieldChange={setSearchField}
          onClear={clearFilters}
        />

        {laggedCount > 0 && (
          <div className="mx-4 px-3 py-1.5 bg-warn/6 border border-warn/12 text-warn text-xs font-medium font-mono rounded-b flex items-center justify-between">
            <span>{t("packets.dropped", { count: laggedCount })}</span>
            <button type="button" className="underline cursor-pointer" onClick={dismissLagged}>{t("common.dismiss")}</button>
          </div>
        )}

        {bannerCount > 0 && (
          <button
            type="button"
            className="mx-4 flex items-center justify-center gap-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/15 border border-primary/20 border-t-0 text-primary text-[11px] font-medium tracking-wide cursor-pointer font-mono rounded-b transition-colors"
            onClick={handleScrollToTop}
          >
            <span aria-hidden>▲</span>
            {t("packets.new", { count: bannerCount })}
            <span className="text-primary/60 font-normal">· {t("packets.scrollTop")}</span>
          </button>
        )}

        {isLoading && packets.length === 0 ? (
          <SkeletonRows />
        ) : (
          <PacketVirtualList
            key={listResetKey}
            packets={packets}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            onScrollAwayFromTop={setIsScrolledAway}
            onAtTopChange={setIsAtTop}
            expandedHash={expandedHash}
            onToggleExpand={handleToggleExpand}
            onOpenAnalyzer={handleOpenAnalyzer}
            onViewPath={handleViewPath}
            selectedObservationId={selectedObservationId}
            onSelectObservation={onSelectObservation}
          />
        )}
        <LoadingPill
          loading={isLoading || isFetchingNextPage}
          error={isError}
          count={packets.length}
          noun={t("packets.noun")}
          position="bottom-3 right-3"
        />
      </div>
    </div>
  );
}
