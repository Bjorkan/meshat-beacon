import { useMemo } from "react";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { brokerQueries, observerQueries } from "../../api/queries";
import { useRegion } from "../../hooks/useRegion";
import { useScopes } from "../../hooks/useScopes";
import { useInfinitePages } from "../../hooks/useInfinitePages";
import { formatHex, formatRadio } from "../../lib/formatters";
import { Badge } from "../../components/Badge";
import { DataTable, type Column, type SortState } from "../../components/DataTable";
import { LoadingPill } from "../../components/LoadingPill";
import { ObserverFilterBar } from "./ObserverFilterBar";
import { deriveObserverStatus } from "./observer-status";
import { useTick } from "../../hooks/useTick";
import type { ObserverSummary } from "./types";

const observerId = (o: ObserverSummary) => o.id; // stable id accessor for the paged hook's dedup

const OBSERVER_SORT_BY_HEADER = {
  Name: "name",
  Type: "type",
  Radio: "radio",
  IATA: "iata",
  Status: "status",
} as const;

export interface ObserverTableViewState {
  search: string;
  searchField: string;
  statusFilter: string;
  typeFilter: string;
  brokerFilter: string;
  scopeFilter: string;
  sort: SortState;
}

interface ObserverTableProps {
  selectedObserverId: string | null;
  onSelectObserver: (id: string | null) => void;
  viewState: ObserverTableViewState;
  onViewStateChange: (patch: Partial<ObserverTableViewState>, options?: { replace?: boolean }) => void;
  onRowIntent?: (id: string) => void;
}

function observerColumns(t: TFunction): Column<ObserverSummary>[] {
  return [
  {
    header: "Name",
    label: t("entities.name"),
    sortValue: (obs) => obs.displayName ?? formatHex(obs.id),
    cell: (obs) => (
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${deriveObserverStatus(obs) === "online" ? "bg-green" : "bg-text-dim/30"}`} />
        <span className={`truncate ${obs.displayName ? "text-text-normal" : "text-text-dim italic"}`}>
          {obs.displayName ?? formatHex(obs.id)}
        </span>
      </div>
    ),
  },
  {
    header: "Type",
    label: t("entities.type"),
    className: "text-text-muted",
    sortValue: (obs) => obs.observerType ?? null,
    cell: (obs) => obs.observerType ?? "—",
  },
  {
    header: "Radio",
    label: t("entities.radio"),
    className: "text-text-muted",
    sortValue: (obs) => formatRadio(obs.radio) ?? null,
    cell: (obs) => formatRadio(obs.radio) ?? "—",
  },
  {
    header: "IATA",
    className: "text-text-normal",
    sortValue: (obs) => obs.iata,
    cell: (obs) => obs.iata,
  },
  {
    header: "Status",
    label: t("entities.status"),
    sortValue: (obs) => deriveObserverStatus(obs),
    cell: (obs) => {
      const status = deriveObserverStatus(obs);
      return <Badge variant={status === "online" ? "live" : "offline"}>{t(`options.${status}`)}</Badge>;
    },
  },
  ];
}

function renderObserverCard(obs: ObserverSummary, t: TFunction) {
  const status = deriveObserverStatus(obs);
  return (
    <div className="flex flex-col gap-1.5 font-mono text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === "online" ? "bg-green" : "bg-text-dim/30"}`} />
          <span className={`flex-1 min-w-0 truncate ${obs.displayName ? "text-text-normal" : "text-text-dim italic"}`}>
            {obs.displayName ?? formatHex(obs.id)}
          </span>
        </div>
        <span className="shrink-0">
          <Badge variant={status === "online" ? "live" : "offline"}>{t(`options.${status}`)}</Badge>
        </span>
      </div>
      <div className="flex items-center gap-2 text-text-muted">
        <span className="text-text-normal">{obs.iata}</span>
        <span>· {obs.observerType ?? "—"}</span>
        <span>· {formatRadio(obs.radio) ?? "—"}</span>
      </div>
    </div>
  );
}

export function ObserverTable({ selectedObserverId, onSelectObserver, viewState, onViewStateChange, onRowIntent }: ObserverTableProps) {
  const { t } = useTranslation();
  const { iatas, regionKey } = useRegion();
  const { search, searchField, statusFilter, typeFilter, brokerFilter, scopeFilter, sort } = viewState;

  useTick(); // keep recency-derived status badges fresh

  const { data: brokers } = useQuery(brokerQueries.list());

  const brokerNames = useMemo(
    () => brokers?.map((b) => b.name) ?? [],
    [brokers],
  );

  const serverSort = OBSERVER_SORT_BY_HEADER[sort.header as keyof typeof OBSERVER_SORT_BY_HEADER] ?? "name";

  // Page the region's observers 50 at a time. Filtering and ordering are server-side, so every page
  // is globally sorted without eagerly downloading the full observer set.
  const listOptions = useMemo(
    () =>
      observerQueries.list({
        regionKey,
        iatas,
        status: statusFilter,
        type: typeFilter,
        broker: brokerFilter,
        name: search,
        searchField,
        scope: scopeFilter || undefined,
        sort: serverSort,
        direction: sort.direction,
      }),
    [regionKey, iatas, statusFilter, typeFilter, brokerFilter, search, searchField, scopeFilter, serverSort, sort.direction],
  );
  const { items: observers, loadedCount, isPaging, isError, isLoading, loadMore } = useInfinitePages<ObserverSummary, string | number | undefined>({
    options: listOptions,
    getId: observerId,
    auto: false,
  });

  const typeOptions = useMemo(() => {
    const types = new Set<string>();
    for (const obs of observers) {
      if (obs.observerType) types.add(obs.observerType);
    }
    return [...types].sort();
  }, [observers]);

  const scopeOptions = useScopes();
  const columns = useMemo(() => observerColumns(t), [t]);



  return (
    <div className="flex flex-1 min-h-0">
      <div className="relative flex flex-col flex-1 min-w-0">
        <ObserverFilterBar
          search={search}
          onSearchChange={(value) => onViewStateChange({ search: value }, { replace: true })}
          searchField={searchField}
          onSearchFieldChange={(value) => onViewStateChange({ searchField: value, search: "" })}
          statusFilter={statusFilter}
          onStatusChange={(value) => onViewStateChange({ statusFilter: value })}
          typeFilter={typeFilter}
          onTypeChange={(value) => onViewStateChange({ typeFilter: value })}
          typeOptions={typeOptions}
          brokerFilter={brokerFilter}
          onBrokerChange={(value) => onViewStateChange({ brokerFilter: value })}
          brokerOptions={brokerNames}
          scopeFilter={scopeFilter}
          onScopeChange={(value) => onViewStateChange({ scopeFilter: value })}
          scopeOptions={scopeOptions}
        />

        <DataTable
          columns={columns}
          rows={observers}
          rowKey={(o) => o.id}
          selectedKey={selectedObserverId}
          onSelect={onSelectObserver}
          onRowIntent={onRowIntent}
          isLoading={isLoading}
          emptyLabel={t("entities.noObservers")}
          sort={sort}
          onSortChange={(value) => onViewStateChange({ sort: value })}
          sortMode="server"
          virtualize
          onEndReached={loadMore}
          renderCard={(observer) => renderObserverCard(observer, t)}
        />
        <LoadingPill loading={isPaging} error={isError} count={loadedCount} noun={t("entities.observers")} position="bottom-3 right-3" />
      </div>

    </div>
  );
}
