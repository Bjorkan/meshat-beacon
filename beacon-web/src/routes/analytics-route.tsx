import { useNavigate, useSearch } from "@tanstack/react-router";
import { StatsOverview } from "../features/stats/StatsOverview";

export function AnalyticsRoute() {
  const search = useSearch({ from: "/analytics" });
  const navigate = useNavigate({ from: "/analytics" });
  return (
    <StatsOverview
      statsTab={search.statsTab ?? "mesh"}
      range={search.range ?? "7d"}
      observerId={search.observerId ?? null}
      onPatch={(updates) => {
        navigate({
          to: ".",
          search: (prev) => {
            const next = { ...prev };
            for (const [key, value] of Object.entries(updates)) {
              (next as Record<string, unknown>)[key] = value ?? undefined;
            }
            return next;
          },
          replace: true,
        });
      }}
    />
  );
}
