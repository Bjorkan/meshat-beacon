import { useCallback, useMemo } from "react";
import { Outlet, useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { ObserverTable, type ObserverTableViewState } from "../features/observers/ObserverTable";
import { ObserverDetailPanel } from "../features/observers/ObserverDetailPanel";
import type { SortState } from "../components/DataTable";
import { useOverlays } from "./overlays";

const HEADER_TO_SORT = { Name: "name", Type: "type", Radio: "radio", IATA: "iata", Status: "status" } as const;
const SORT_TO_HEADER: Record<string, SortState["header"]> = {
  name: "Name",
  type: "Type",
  radio: "Radio",
  iata: "IATA",
  status: "Status",
};

function observerViewState(search: Record<string, unknown>): ObserverTableViewState {
  return {
    search: typeof search.oq === "string" ? search.oq : "",
    searchField: "name",
    statusFilter: search.ost === "online" || search.ost === "offline" ? search.ost : "",
    typeFilter: typeof search.ot === "string" ? search.ot : "",
    brokerFilter: typeof search.ob === "string" ? search.ob : "",
    scopeFilter: typeof search.os === "string" ? search.os : "",
    sort: {
      header: SORT_TO_HEADER[typeof search.osort === "string" ? search.osort : "name"] ?? "Name",
      direction: search.odir === "desc" ? "desc" : "asc",
    },
  };
}

export function ObserversRoute() {
  const params = useParams({ strict: false }) as { observerId?: string };
  const search = useSearch({ from: "/observers" });
  const navigate = useNavigate({ from: "/observers" });
  const router = useRouter();
  const viewState = useMemo(() => observerViewState(search as Record<string, unknown>), [search]);

  const onViewStateChange = useCallback((patch: Partial<ObserverTableViewState>, options?: { replace?: boolean }) => {
    navigate({
      to: ".",
      replace: options?.replace,
      search: (prev) => {
        const sortName = patch.sort ? HEADER_TO_SORT[patch.sort.header as keyof typeof HEADER_TO_SORT] ?? "name" : undefined;
        return {
          ...prev,
          ...(patch.search !== undefined ? { oq: patch.search || undefined } : {}),
          ...(patch.statusFilter !== undefined ? { ost: (patch.statusFilter || undefined) as "online" | "offline" | undefined } : {}),
          ...(patch.typeFilter !== undefined ? { ot: patch.typeFilter || undefined } : {}),
          ...(patch.brokerFilter !== undefined ? { ob: patch.brokerFilter || undefined } : {}),
          ...(patch.scopeFilter !== undefined ? { os: patch.scopeFilter || undefined } : {}),
          ...(patch.sort !== undefined ? {
            osort: sortName === "name" ? undefined : sortName,
            odir: patch.sort.direction === "asc" ? undefined : patch.sort.direction,
          } : {}),
        };
      },
    });
  }, [navigate]);

  const selectObserver = useCallback((id: string | null) => {
    navigate({
      to: id ? "/observers/$observerId" : "/observers",
      params: id ? { observerId: id } : undefined,
      search,
    });
  }, [navigate, search]);

  const preloadObserver = useCallback((id: string) => {
    void router.preloadRoute({
      to: "/observers/$observerId",
      params: { observerId: id },
      search,
    });
  }, [router, search]);

  return (
    <>
      <ObserverTable
        selectedObserverId={params.observerId ?? null}
        onSelectObserver={selectObserver}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        onRowIntent={preloadObserver}
      />
      <Outlet />
    </>
  );
}

export function ObserverDetailRoute() {
  const { observerId } = useParams({ from: "/observers/$observerId" });
  const navigate = useNavigate({ from: "/observers/$observerId" });
  const overlays = useOverlays();
  const close = useCallback(() => {
    navigate({ to: "/observers", search: (prev) => ({ ...prev }) });
  }, [navigate]);

  return (
    <ObserverDetailPanel
      observerId={observerId}
      onClose={close}
      onAnalyzePacket={overlays.setOverlayPacketHash}
      onViewStats={overlays.viewObserverStats}
    />
  );
}
