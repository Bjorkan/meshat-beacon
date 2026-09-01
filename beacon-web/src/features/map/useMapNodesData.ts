import { useInfinitePages } from "../../hooks/useInfinitePages";
import { nodeQueries } from "../../api/queries";
import type { NodeSummary } from "../nodes/types";

const nodeId = (n: NodeSummary) => n.id;

// Page the selected region's nodes 50 at a time for the map, so the canvas fills batch by batch
// instead of waiting for one big response. Thin wrapper over the shared useInfinitePages (which owns
// the auto-chain, dedup, and error handling). Loads once per region; WS updates keep nodes live.
// Deliberately a separate key from the Nodes table: the map always wants neighborIds (just UUIDs)
// so the neighbor-lines toggle is a pure client-side render switch — no refetch when toggling.
export function useMapNodesData(
  selectedIatas: string[] | undefined,
  regionKey: string,
  opts?: { enabled?: boolean },
) {
  const { items, loadedCount, isPaging, isError } =
    useInfinitePages<NodeSummary, string | number | undefined>({
      options: nodeQueries.mapList({ regionKey, iatas: selectedIatas }),
      getId: nodeId,
      enabled: opts?.enabled,
    });
  return { nodes: items, loadedCount, isPaging, isError };
}
