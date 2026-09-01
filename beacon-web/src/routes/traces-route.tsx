import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { TraceList } from "../features/traces/TraceList";
import type { TraceType } from "../types/api";
import { useOverlays } from "./overlays";

export function TracesRoute() {
  const search = useSearch({ from: "/traces" });
  const navigate = useNavigate({ from: "/traces" });
  const overlays = useOverlays();
  const typeFilter = search.tt === "TRACE" || search.tt === "PING" ? search.tt : "";
  const onTypeFilterChange = useCallback((value: "" | TraceType) => {
    navigate({ to: ".", search: (prev) => ({ ...prev, tt: value || undefined }) });
  }, [navigate]);
  return (
    <TraceList
      onAnalyze={overlays.setOverlayPacketHash}
      onViewNode={overlays.setOverlayNodeId}
      typeFilter={typeFilter}
      onTypeFilterChange={onTypeFilterChange}
    />
  );
}
