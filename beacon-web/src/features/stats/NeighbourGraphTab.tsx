import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useRegion } from "../../hooks/useRegion";
import { useMapNodesData } from "../map/useMapNodesData";
import { nodeQueries } from "../../api/queries";
import { useChartColors } from "./chartTheme";
import { buildNeighbourGraph, buildEgoGraph, neighbourGraphOption } from "./neighbour-graph";
import { NeighbourGraph } from "./NeighbourGraph";
import { EmptyState } from "../../components/EmptyState";
import { SearchBar, type SearchFieldOption } from "../../components/SearchBar";

// Most-connected nodes rendered; past this the canvas force layout bogs down. Reuses the map's node
// query (same cache), so the whole region still loads — this only caps what the full mesh draws.
const CAP = 1000;

export function NeighbourGraphTab() {
  const { t } = useTranslation();
  const { iatas, regionKey } = useRegion();
  // "All regions" is 5k+ nodes — too heavy for the canvas force layout, so gate the fetch off and
  // prompt for a region instead of freezing the browser.
  const isAll = regionKey === "*";
  const { nodes, loadedCount, isPaging, isError } = useMapNodesData(iatas, regionKey, { enabled: !isAll });
  const colors = useChartColors();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("name");
  const searchFields: SearchFieldOption[] = [{ value: "name", label: t("fields.name") }];

  // a different region is a different mesh — drop any stale selection/search (adjust-during-render)
  const [region, setRegion] = useState(regionKey);
  if (region !== regionKey) {
    setRegion(regionKey);
    setSelectedId(null);
    setSearch("");
  }

  // focusing a node clears the search so the ego view isn't dimmed by a stale query
  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setSearch("");
  }, []);

  const graph = useMemo(() => buildNeighbourGraph(nodes, CAP), [nodes]);
  const selectedNode = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, nodes],
  );

  // Selected node's neighbours (shared cache with the map + node panel); dataUpdatedAt stands in for
  // "now" so the freshness fade is pure at render time.
  const { data: neighbours, dataUpdatedAt } = useQuery({
    ...nodeQueries.neighbors(selectedId ?? ""),
    enabled: !!selectedId,
  });
  const ego = useMemo(() => {
    if (!selectedId || !neighbours) return null;
    // fall back to a bare centre if the node was heard from another region (not in the loaded set)
    const center = selectedNode ?? { id: selectedId, name: null, nodeTypeName: "" };
    return buildEgoGraph(center, neighbours, dataUpdatedAt);
  }, [selectedId, selectedNode, neighbours, dataUpdatedAt]);

  const option = useMemo(() => neighbourGraphOption(ego ?? graph, colors, { ego: !!ego, t }), [ego, graph, colors, t]);

  if (isAll)
    return (
      <EmptyState
        title={t("stats.pickRegion")}
        subtitle={t("stats.pickRegionHint")}
      />
    );
  if (isError) return <EmptyState title={t("stats.neighbourGraph")} subtitle={t("stats.failedNodes")} />;
  // build only once the pager settles, or the force layout would restart on every streamed page
  if (isPaging) return <EmptyState title={t("stats.loadingMesh")} subtitle={t("stats.nodeCount", { count: loadedCount })} />;
  if (graph.nodes.length === 0) return <EmptyState title={t("stats.neighbourGraph")} subtitle={t("stats.noNodesRegion")} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {ego ? (
        <div className="shrink-0 border-b border-border bg-bg-surface px-4 py-2 text-center text-xs font-mono text-text-muted">
          {t("stats.neighbourhood", { name: selectedNode?.name ?? selectedId, count: ego.nodes.length - 1 })}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-surface px-4 py-2">
          <span className="text-xs font-mono text-text-muted">
            {graph.capped ? t("stats.showingNodes", { shown: CAP, total: graph.total }) : t("stats.nodeCount", { count: graph.total })}
          </span>
          <div className="ml-auto">
            <SearchBar value={search} onChange={setSearch} fields={searchFields} field={searchField} onFieldChange={setSearchField} />
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <NeighbourGraph option={option} nodes={(ego ?? graph).nodes} search={ego ? "" : search} onSelect={handleSelect} />
      </div>
    </div>
  );
}
