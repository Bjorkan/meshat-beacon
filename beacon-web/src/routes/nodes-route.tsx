import { useCallback, useMemo } from "react";
import { Outlet, useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { NodeTable, type NodeTableViewState } from "../features/nodes/NodeTable";
import { NodeDetailPanel } from "../features/nodes/NodeDetailPanel";
import type { MultibyteFilter } from "../features/nodes/NodeFilterBar";
import type { SortState } from "../components/DataTable";
import { useOverlays } from "./overlays";

const HEADER_TO_SORT = { Name: "name", Type: "type", Radio: "radio", Neighbors: "neighbors" } as const;
const SORT_TO_HEADER: Record<string, SortState["header"]> = {
  name: "Name",
  type: "Type",
  radio: "Radio",
  neighbors: "Neighbors",
};

function nodeViewState(search: Record<string, unknown>): NodeTableViewState {
  return {
    typeFilter: typeof search.nt === "string" ? search.nt : "",
    pathsFilter: (search.np === "true" || search.np === "false" ? search.np : "") as MultibyteFilter,
    tracesFilter: (search.ntr === "true" || search.ntr === "false" ? search.ntr : "") as MultibyteFilter,
    scopeFilter: typeof search.ns === "string" ? search.ns : "",
    sort: {
      header: SORT_TO_HEADER[typeof search.nsort === "string" ? search.nsort : "name"] ?? "Name",
      direction: search.ndir === "desc" ? "desc" : "asc",
    },
    search: typeof search.nq === "string" ? search.nq : "",
    searchField: search.nsf === "pubkey" ? "pubkey" : "name",
  };
}

export function NodesRoute() {
  const params = useParams({ strict: false }) as { nodeId?: string };
  const search = useSearch({ from: "/nodes" });
  const navigate = useNavigate({ from: "/nodes" });
  const router = useRouter();
  const viewState = useMemo(() => nodeViewState(search as Record<string, unknown>), [search]);

  const onViewStateChange = useCallback((patch: Partial<NodeTableViewState>, options?: { replace?: boolean }) => {
    navigate({
      to: ".",
      replace: options?.replace,
      search: (prev) => {
        const sortName = patch.sort ? HEADER_TO_SORT[patch.sort.header as keyof typeof HEADER_TO_SORT] ?? "name" : undefined;
        return {
          ...prev,
          ...(patch.typeFilter !== undefined ? { nt: patch.typeFilter || undefined } : {}),
          ...(patch.pathsFilter !== undefined ? { np: patch.pathsFilter || undefined } : {}),
          ...(patch.tracesFilter !== undefined ? { ntr: patch.tracesFilter || undefined } : {}),
          ...(patch.scopeFilter !== undefined ? { ns: patch.scopeFilter || undefined } : {}),
          ...(patch.search !== undefined ? { nq: patch.search || undefined } : {}),
          ...(patch.searchField !== undefined ? { nsf: (patch.searchField === "name" ? undefined : patch.searchField) as "pubkey" | undefined } : {}),
          ...(patch.sort !== undefined ? {
            nsort: sortName === "name" ? undefined : sortName,
            ndir: patch.sort.direction === "asc" ? undefined : patch.sort.direction,
          } : {}),
        };
      },
    });
  }, [navigate]);

  const selectNode = useCallback((id: string | null) => {
    navigate({
      to: id ? "/nodes/$nodeId" : "/nodes",
      params: id ? { nodeId: id } : undefined,
      search,
    });
  }, [navigate, search]);

  const preloadNode = useCallback((id: string) => {
    void router.preloadRoute({
      to: "/nodes/$nodeId",
      params: { nodeId: id },
      search,
    });
  }, [router, search]);

  return (
    <>
      <NodeTable
        selectedNodeId={params.nodeId ?? null}
        onSelectNode={selectNode}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        onRowIntent={preloadNode}
      />
      <Outlet />
    </>
  );
}

export function NodeDetailRoute() {
  const { nodeId } = useParams({ from: "/nodes/$nodeId" });
  const navigate = useNavigate({ from: "/nodes/$nodeId" });
  const overlays = useOverlays();
  const close = useCallback(() => {
    navigate({ to: "/nodes", search: (prev) => ({ ...prev }) });
  }, [navigate]);
  const selectNode = useCallback((id: string | null) => {
    navigate({
      to: id ? "/nodes/$nodeId" : "/nodes",
      params: id ? { nodeId: id } : undefined,
      search: true,
    });
  }, [navigate]);

  return (
    <NodeDetailPanel
      nodeId={nodeId}
      onClose={close}
      onViewObserver={overlays.selectObserver}
      onViewNode={selectNode}
      onAnalyzePacket={overlays.setOverlayPacketHash}
    />
  );
}
