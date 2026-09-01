import { useCallback } from "react";
import { StatsSubHeader } from "./StatsSubHeader";
import { MeshTab } from "./MeshTab";
import { TalkersTab } from "./TalkersTab";
import { ClockDriftTab } from "./ClockDriftTab";
import { ObserverTab } from "./ObserverTab";
import { NeighbourGraphTab } from "./NeighbourGraphTab";
import type { StatsRange, StatsTab } from "./types";

interface StatsOverviewProps {
  // analytics sub-state, owned by the /analytics route's search params
  statsTab: StatsTab;
  range: StatsRange;
  observerId: string | null;
  // applied onto the route search (replace:true keeps it out of history)
  onPatch: (updates: Record<string, string | null>) => void;
}

// Stats page shell: a sub-header bar (Mesh / Observer pills + range) over the active
// sub-tab. Sub-tab, range, and selected observer live in the /analytics search params so the view
// is shareable; replace:true keeps it out of history. Queries are cached, so switching is instant.
export function StatsOverview({ statsTab: tab, range, observerId, onPatch }: StatsOverviewProps) {

  const handleTab = useCallback((t: StatsTab) => onPatch({ statsTab: t }), [onPatch]);
  const handleRange = useCallback((r: StatsRange) => onPatch({ range: r }), [onPatch]);
  const handleSelectObserver = useCallback((id: string) => onPatch({ statsTab: "observer", observerId: id }), [onPatch]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StatsSubHeader tab={tab} onTabChange={handleTab} range={range} onRangeChange={handleRange} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "mesh" && <MeshTab range={range} onSelectObserver={handleSelectObserver} />}
        {tab === "talkers" && <TalkersTab range={range} />}
        {tab === "clockdrift" && <ClockDriftTab />}
        {tab === "observer" && (
          <ObserverTab range={range} selectedObserverId={observerId} onSelectObserver={handleSelectObserver} />
        )}
        {tab === "graph" && <NeighbourGraphTab />}
      </div>
    </div>
  );
}
