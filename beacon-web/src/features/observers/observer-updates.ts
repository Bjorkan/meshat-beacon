import type { ObserverSummary } from "./types";
import type { WsObserverStatus } from "../../types/ws";

export interface ObserverListUpdateContext {
  sort: "name" | "type" | "radio" | "iata" | "status" | "last_seen";
  status?: string;
  type?: string;
  name?: string;
  scope?: string;
  iatas?: readonly string[];
}

function sameStrings(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nextObserverSummary(prev: ObserverSummary, data: WsObserverStatus["data"]): ObserverSummary {
  return {
    ...prev,
    status: data.online ? "online" : "offline",
    displayName: data.displayName || prev.displayName,
    observerType: data.observerType ?? prev.observerType,
    iata: data.iata || prev.iata,
    radio: data.radio ?? prev.radio,
    scopes: data.scopes === undefined ? prev.scopes : (data.scopes ?? []),
    lastStatusAt: data.lastStatusAt || prev.lastStatusAt,
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

/** See nodeListUpdateRequiresRefetch for the same invariant on Nodes. */
export function observerListUpdateRequiresRefetch(
  prev: ObserverSummary,
  data: WsObserverStatus["data"],
  context: ObserverListUpdateContext,
): boolean {
  const next = nextObserverSummary(prev, data);

  if (context.sort === "name" && next.displayName !== prev.displayName) return true;
  if (context.sort === "type" && next.observerType !== prev.observerType) return true;
  if (context.sort === "radio" && next.radio !== prev.radio) return true;
  if (context.sort === "iata" && next.iata !== prev.iata) return true;
  if (context.sort === "status" && next.status !== prev.status) return true;

  if (context.status && (prev.status === context.status) !== (next.status === context.status)) return true;
  if (context.type && (prev.observerType === context.type) !== (next.observerType === context.type)) return true;
  if (context.name && includesCI(prev.displayName, context.name) !== includesCI(next.displayName, context.name)) return true;
  if (context.scope) {
    const before = (prev.scopes ?? []).includes(context.scope);
    const after = (next.scopes ?? []).includes(context.scope);
    if (before !== after) return true;
  }
  if (context.iatas?.length && intersects(context.iatas, [prev.iata]) !== intersects(context.iatas, [next.iata])) return true;

  return false;
}

// Patch a known observer in-place. The table checks ordering/filter-sensitive changes before using
// this helper, so live status metadata can stay fresh without refetching every heartbeat.
export function patchObserverSummary(
  list: ObserverSummary[] | undefined,
  data: WsObserverStatus["data"],
): ObserverSummary[] | undefined {
  if (!list) return list;
  const idx = list.findIndex((o) => o.id === data.observerId);
  if (idx === -1) return list;
  const prev = list[idx]!;
  const next = nextObserverSummary(prev, data);
  if (
    next.status === prev.status &&
    next.displayName === prev.displayName &&
    next.observerType === prev.observerType &&
    next.iata === prev.iata &&
    next.radio === prev.radio &&
    next.lastStatusAt === prev.lastStatusAt &&
    sameStrings(next.scopes, prev.scopes)
  ) return list;
  const updated = [...list];
  updated[idx] = next;
  return updated;
}
