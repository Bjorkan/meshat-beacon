import type { InfiniteData } from "@tanstack/react-query";
import type { NodeSummary } from "./types";
import type { CursorPage } from "../../types/api";
import type { WsNodeUpdate } from "../../types/ws";
import { patchInfinitePages } from "../../lib/infinite-pages";

export interface NodeListUpdateContext {
  sort: "name" | "type" | "radio" | "neighbors" | "last_seen";
  type?: string;
  name?: string;
  pubkeyPrefix?: string;
  scope?: string;
  iatas?: readonly string[];
}

function sameIATAs(a: NodeSummary["iatas"], b: NodeSummary["iatas"]): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index];
    return other != null && entry.iata === other.iata && entry.lastHeard === other.lastHeard;
  });
}

function nextNodeSummary(prev: NodeSummary, data: WsNodeUpdate["data"]): NodeSummary {
  return {
    ...prev,
    publicKey: data.publicKey || prev.publicKey,
    nodeType: data.nodeType ?? prev.nodeType,
    nodeTypeName: data.nodeTypeName ?? prev.nodeTypeName,
    name: data.name || prev.name,
    lat: data.lat ?? prev.lat,
    lng: data.lng ?? prev.lng,
    radio: data.radio ?? prev.radio,
    defaultScope: data.defaultScope ?? prev.defaultScope,
    iatas: data.iatas ?? prev.iatas,
    isObserver: data.isObserver ?? prev.isObserver,
  };
}

function intersects(selected: readonly string[] | undefined, values: readonly string[]): boolean {
  if (!selected?.length) return true;
  const selectedSet = new Set(selected.map((value) => value.toUpperCase()));
  return values.some((value) => selectedSet.has(value.toUpperCase()));
}

function includesCI(value: string | null | undefined, needle: string | undefined): boolean {
  if (!needle) return true;
  return (value ?? "").toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

/**
 * Server-sorted pages must be invalidated when a live update changes their ordering key or whether
 * the row belongs to the active filter. These changes are rare; ordinary advert updates can still
 * use the cheap in-place patch below without refetching the list.
 */
export function nodeListUpdateRequiresRefetch(
  prev: NodeSummary,
  data: WsNodeUpdate["data"],
  context: NodeListUpdateContext,
): boolean {
  const next = nextNodeSummary(prev, data);

  if (context.sort === "name" && next.name !== prev.name) return true;
  if (context.sort === "type" && next.nodeType !== prev.nodeType) return true;
  if (context.sort === "radio" && next.radio !== prev.radio) return true;

  if (context.type && (prev.nodeTypeName === context.type) !== (next.nodeTypeName === context.type)) return true;
  if (context.name && includesCI(prev.name, context.name) !== includesCI(next.name, context.name)) return true;
  if (context.pubkeyPrefix) {
    const prefix = context.pubkeyPrefix.toLocaleLowerCase();
    if (prev.publicKey.toLocaleLowerCase().startsWith(prefix) !== next.publicKey.toLocaleLowerCase().startsWith(prefix)) return true;
  }
  if (context.scope && (prev.defaultScope === context.scope) !== (next.defaultScope === context.scope)) return true;
  if (context.iatas?.length) {
    const before = intersects(context.iatas, prev.iatas.map((entry) => entry.iata));
    const after = intersects(context.iatas, next.iatas.map((entry) => entry.iata));
    if (before !== after) return true;
  }

  return false;
}

// Lightweight patch used by the map: only name/coords are applied so frequent adverts don't
// rebuild the entire map FeatureCollection for IATA/radio timestamp churn.
export function patchNodeSummary(
  list: NodeSummary[] | undefined,
  data: WsNodeUpdate["data"],
): NodeSummary[] | undefined {
  if (!list) return list;
  const idx = list.findIndex((n) => n.id === data.nodeId);
  if (idx === -1) return list;
  const prev = list[idx]!;
  const name = data.name || prev.name;
  const lat = data.lat ?? prev.lat;
  const lng = data.lng ?? prev.lng;
  if (name === prev.name && lat === prev.lat && lng === prev.lng) return list;
  const updated = [...list];
  updated[idx] = { ...prev, name, lat, lng };
  return updated;
}

// Richer patch for the Nodes table. Ordering/filter-sensitive changes are handled by
// nodeListUpdateRequiresRefetch before this is called; the remaining fields can be refreshed in
// place without throwing away already loaded pages.
export function patchNodeTableSummary(
  list: NodeSummary[] | undefined,
  data: WsNodeUpdate["data"],
): NodeSummary[] | undefined {
  if (!list) return list;
  const idx = list.findIndex((n) => n.id === data.nodeId);
  if (idx === -1) return list;
  const prev = list[idx]!;
  const next = nextNodeSummary(prev, data);
  if (
    next.publicKey === prev.publicKey &&
    next.nodeType === prev.nodeType &&
    next.nodeTypeName === prev.nodeTypeName &&
    next.name === prev.name &&
    next.lat === prev.lat &&
    next.lng === prev.lng &&
    next.radio === prev.radio &&
    next.defaultScope === prev.defaultScope &&
    next.isObserver === prev.isObserver &&
    sameIATAs(next.iatas, prev.iatas)
  ) return list;

  const updated = [...list];
  updated[idx] = next;
  return updated;
}

// Patch-or-insert for the map's unfiltered node cache. A nodeUpdate event carries a full summary,
// so a node we've never fetched can join the map live instead of waiting for a reload (the cache
// never refetches on its own — staleTime is Infinity).
export function upsertNodePages(
  old: InfiniteData<CursorPage<NodeSummary>> | undefined,
  data: WsNodeUpdate["data"],
): InfiniteData<CursorPage<NodeSummary>> | undefined {
  if (!old || old.pages.length === 0) return old;
  if (old.pages.some((p) => p.items.some((n) => n.id === data.nodeId))) {
    return patchInfinitePages(old, (items) => patchNodeSummary(items, data) ?? items);
  }
  const fresh: NodeSummary = {
    id: data.nodeId,
    publicKey: data.publicKey,
    nodeType: data.nodeType,
    nodeTypeName: data.nodeTypeName,
    name: data.name || null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    radio: data.radio,
    defaultScope: data.defaultScope,
    iatas: data.iatas,
    knownNeighborCount: 0,
    isObserver: data.isObserver,
  };
  const pages = [...old.pages];
  const last = pages[pages.length - 1]!;
  pages[pages.length - 1] = { ...last, items: [...last.items, fresh] };
  return { ...old, pages };
}
