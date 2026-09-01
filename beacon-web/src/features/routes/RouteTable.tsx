import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { iataQueries, routeQueries } from "../../api/queries";
import { useRegion } from "../../hooks/useRegion";
import { useInfinitePages } from "../../hooks/useInfinitePages";
import { Badge } from "../../components/Badge";
import { Timestamp } from "../../components/Timestamp";
import { DataTable, type Column, type SortState } from "../../components/DataTable";
import { LoadingPill } from "../../components/LoadingPill";
import { MultiSelectDropdown } from "../../components/MultiSelectDropdown";
import { RouteDetailPanel } from "./RouteDetailPanel";
import { ResolvedHopBlock } from "../packets/PathData";
import { formatHex } from "../../lib/formatters";
import type { KnownRoute, CrossIATARoute, ResolvedHop, ResolvedNode, RouteHop } from "../../types/api";

const inputClass =
  "text-[11px] font-mono bg-bg-surface border border-border rounded-sm px-2 py-1 text-text-bright " +
  "placeholder:text-text-dim transition-colors";

// stable id accessor for the paginator's dedup (module-level so the memo isn't rebuilt each render)
const routeId = (r: KnownRoute) => String(r.id);

const ROUTE_SORT_KEYS: Record<string, string> = {
  IATA: "iata",
  Hops: "hops",
  Obs: "observations",
  "First seen": "first_seen",
  "Last seen": "last_seen",
};

const nodeLabel = (n: ResolvedNode) => n.name ?? formatHex(n.publicKey);

// A run of route hops as a hash chain (reusing the packet path renderer); hops are high-confidence.
function HopChain({ hops }: { hops: RouteHop[] }) {
  return (
    <>
      {hops.map((hop, i) => {
        const resolved: ResolvedHop = { confidence: "high", nodes: hop.node ? [hop.node] : [] };
        return (
          <span key={i} className="contents">
            {i > 0 && <span className="text-text-dim" aria-hidden>→</span>}
            <ResolvedHopBlock hop={resolved} label={hop.hashBytes.toUpperCase()} />
          </span>
        );
      })}
    </>
  );
}

// Memoized so the 10s <Timestamp> ticks in sibling columns don't re-reconcile the chain and its popovers.
const RouteHopChain = memo(function RouteHopChain({ route }: { route: KnownRoute }) {
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[13px]">
      <HopChain hops={route.hops} />
    </div>
  );
});

// A cross-IATA route: source segment → boundary hop (the two nodes that bridge the IATAs) → target segment.
function CrossRouteCard({ route }: { route: CrossIATARoute }) {
  const { t } = useTranslation();
  const { crossHop } = route;
  return (
    <div className="bg-bg-base border border-border rounded px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="default">{crossHop.fromIata}</Badge>
          <span className="text-text-dim" aria-hidden>→</span>
          <Badge variant="default">{crossHop.toIata}</Badge>
        </div>
        <span className="font-mono text-[11px] text-text-dim">{t("packets.hop", { count: route.totalHops })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 font-mono text-[13px]">
        <HopChain hops={route.sourceSegment} />
        {route.sourceSegment.length > 0 && <span className="text-warn" aria-hidden>⇒</span>}
        <span className="text-primary font-semibold">{nodeLabel(crossHop.fromNode)}</span>
        <span className="text-warn" aria-hidden>⇒</span>
        <span className="text-primary font-semibold">{nodeLabel(crossHop.toNode)}</span>
        {route.targetSegment.length > 0 && <span className="text-warn" aria-hidden>⇒</span>}
        <HopChain hops={route.targetSegment} />
      </div>
    </div>
  );
}

function routeColumns(t: TFunction): Column<KnownRoute>[] {
  return [
  {
    header: "IATA",
    sortValue: (r) => r.iata,
    cell: (r) => <Badge variant="default">{r.iata}</Badge>,
  },
  {
    header: "Hops",
    label: t("packets.hops"),
    sortValue: (r) => r.hopCount,
    cell: (r) => r.hopCount,
  },
  {
    header: "Route",
    label: t("routes.route"),
    cell: (r) => <RouteHopChain route={r} />,
  },
  {
    header: "Obs",
    className: "text-text-muted",
    sortValue: (r) => r.observationCount,
    cell: (r) => r.observationCount.toLocaleString(),
  },
  {
    header: "First seen",
    label: t("routes.firstSeen"),
    className: "text-text-muted",
    sortValue: (r) => r.firstSeen,
    cell: (r) => <Timestamp value={r.firstSeen} />,
  },
  {
    header: "Last seen",
    label: t("routes.lastSeen"),
    className: "text-text-muted",
    sortValue: (r) => r.lastSeen,
    cell: (r) => <Timestamp value={r.lastSeen} />,
  },
  ];
}

function renderRouteCard(r: KnownRoute, t: TFunction) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="default">{r.iata}</Badge>
        <span className="font-mono text-[11px] text-text-dim">{t("routes.summary", { hops: r.hopCount, observations: r.observationCount.toLocaleString() })}</span>
      </div>
      <RouteHopChain route={r} />
      <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
        <span>{t("common.first")} <Timestamp value={r.firstSeen} /></span>
        <span aria-hidden>·</span>
        <span>{t("common.last")} <Timestamp value={r.lastSeen} /></span>
      </div>
    </div>
  );
}

interface SearchParams {
  from: string;
  to: string;
  iatas: string[];
}

export function RouteTable() {
  const { t } = useTranslation();
  const { iatas, regionKey } = useRegion();
  const columns = useMemo(() => routeColumns(t), [t]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ header: "Last seen", direction: "desc" });

  // drop the selection when the region changes — the selected route may not be in the new region
  const prevRegion = useRef(regionKey);
  useEffect(() => {
    if (prevRegion.current !== regionKey) {
      prevRegion.current = regionKey;
      setSelectedKey(null);
    }
  }, [regionKey]);

  // path search form: source→dest hashes, scoped to a multi-select of IATAs. One IATA → within-IATA
  // /routes/search; two+ → /routes/cross across the directed pairs. Hashes + ≥1 IATA required.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searchIatas, setSearchIatas] = useState<string[]>([]);
  const [search, setSearch] = useState<SearchParams | null>(null);
  const isCross = search != null && search.iatas.length >= 2;

  // Region filtering and every sortable column are handled by the keyset-paginated endpoint. A sort
  // change creates a new query key and starts at the first correctly ordered page.
  const { items: listRoutes, loadedCount, isPaging, isError, isLoading: listLoading, loadMore } =
    useInfinitePages<KnownRoute, string | undefined>({
      options: routeQueries.list({
        iatas,
        sort: ROUTE_SORT_KEYS[sort.header] ?? "last_seen",
        direction: sort.direction,
      }),
      getId: routeId,
      auto: false,
    });

  const { data: searchRoutes, isLoading: searchLoading } = useQuery({
    ...routeQueries.search(search ? { iata: search.iatas[0]!, from: search.from, to: search.to } : null),
    enabled: search !== null && !isCross,
  });

  const { data: crossRoutes, isLoading: crossLoading } = useQuery(
    routeQueries.cross(search && isCross ? { iatas: search.iatas, fromHash: search.from, toHash: search.to } : null),
  );

  // IATA options for the path-search multi-select, from /iatas (shares the region picker's cached
  // query). The label carries the display name so the dropdown's search filter matches on it.
  const { data: iataCodes } = useQuery({
    ...iataQueries.list(),
  });
  const iataOptions = useMemo(
    () => (iataCodes ?? []).map((i) => ({ value: i.iata, label: i.displayName ? `${i.iata} — ${i.displayName}` : i.iata })),
    [iataCodes],
  );

  const rows = useMemo(
    () => (search ? (isCross ? [] : searchRoutes) : listRoutes),
    [search, isCross, searchRoutes, listRoutes],
  );

  const selectedRoute = useMemo(
    () => rows?.find((r) => String(r.id) === selectedKey),
    [rows, selectedKey],
  );

  const canSearch = !!(from.trim() && to.trim() && searchIatas.length >= 1);
  // clear any selection when the visible list changes out from under it (search submit/clear)
  const submitSearch = useCallback(() => {
    if (!from.trim() || !to.trim() || searchIatas.length < 1) return;
    setSearch({ from: from.trim(), to: to.trim(), iatas: searchIatas });
    setSelectedKey(null);
  }, [from, to, searchIatas]);
  const clearSearch = useCallback(() => {
    setSearch(null);
    setSelectedKey(null);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submitSearch();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 w-full">
      {/* stacks in compact mode; the inputs would otherwise wrap around the arrow */}
      <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-1.5 gap-y-1.5 px-4 py-2 border-b border-border-subtle bg-bg-base shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted text-[11px] uppercase tracking-wider mr-1 shrink-0">{t("routes.findPath")}</span>
          <input
            className={`${inputClass} flex-1 min-w-0 lg:flex-none lg:w-24`}
            placeholder={t("routes.fromHash")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="text-text-dim text-xs shrink-0" aria-hidden>→</span>
          <input
            className={`${inputClass} flex-1 min-w-0 lg:flex-none lg:w-24`}
            placeholder={t("routes.toHash")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <MultiSelectDropdown
            label="IATA"
            options={iataOptions}
            selected={searchIatas}
            onChange={setSearchIatas}
            align="left"
          />
          <button
            type="button"
            onClick={submitSearch}
            disabled={!canSearch}
            className="text-[11px] font-mono px-2 py-1 rounded-sm border border-border bg-bg-surface text-text-normal hover:border-primary-dim disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {t("routes.search")}
          </button>
          {search && (
            <button
              type="button"
              onClick={clearSearch}
              className="text-[11px] font-mono px-2 py-1 rounded-sm text-text-dim hover:text-text-normal cursor-pointer transition-colors"
            >
              {t("common.clear")}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {isCross ? (
          <div className="flex-1 min-w-0 overflow-y-auto p-3 flex flex-col gap-2">
            {crossLoading ? (
              <div className="font-mono text-[13px] text-text-dim">{t("routes.searching")}</div>
            ) : crossRoutes && crossRoutes.length > 0 ? (
              crossRoutes.map((r, i) => <CrossRouteCard key={i} route={r} />)
            ) : (
              <div className="font-mono text-[13px] text-text-dim">{t("routes.noCrossIata")}</div>
            )}
          </div>
        ) : (
          <div className="relative flex-1 min-w-0 flex flex-col min-h-0">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(r) => String(r.id)}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              isLoading={search ? searchLoading : listLoading}
              emptyLabel={t(search ? "routes.noMatching" : "routes.none")}
              sort={sort}
              onSortChange={setSort}
              sortMode={search ? "client" : "server"}
              onEndReached={search ? undefined : loadMore}
              renderCard={(route) => renderRouteCard(route, t)}
            />
            {!search && (
              <LoadingPill loading={isPaging} error={isError} count={loadedCount} noun={t("routes.noun")} position="bottom-3 right-3" />
            )}
          </div>
        )}
        {selectedRoute && (
          <RouteDetailPanel route={selectedRoute} onClose={() => setSelectedKey(null)} />
        )}
      </div>
    </div>
  );
}
