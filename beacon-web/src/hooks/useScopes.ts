import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { scopeQueries } from "../api/queries";

// The configured transport scope names (e.g. "#bc", "#west"), from /scopes. This is the authoritative
// list — the scope filters use it for their options so they show every configured scope even before any
// packet/node/observer has been matched to one. Scopes are near-static, so cache long and share across
// tabs via React Query. The filtering itself stays client-side on each record's scope.
export function useScopes(): string[] {
  const { data } = useQuery(scopeQueries.list());

  return useMemo(() => [...(data ?? [])].sort(), [data]);
}
