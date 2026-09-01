import { useQuery } from "@tanstack/react-query";
import { observerQueries, telemetryQueries } from "../../api/queries";
import type { StatsRange } from "./types";

export function useObserver(observerId: string | null) {
  return useQuery(observerQueries.detail(observerId ?? ""));
}

export function useObserverTelemetry(observerId: string | null, range: StatsRange) {
  return useQuery(telemetryQueries.range(observerId ?? "", range));
}
