import { Segmented } from "./Segmented";
import { useTranslation } from "react-i18next";
import { SelectDropdown } from "../../components/SelectDropdown";
import { useIsMobile } from "../../hooks/useMediaQuery";
import type { StatsRange, StatsTab } from "./types";

function MeshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="3" cy="3" r="1.6" />
      <circle cx="11" cy="4" r="1.6" />
      <circle cx="7" cy="11" r="1.6" />
      <path d="M4.3 3.6 9.7 4.4M3.6 4.4 6.4 9.6M10.4 5.4 7.7 9.7" strokeOpacity="0.7" />
    </svg>
  );
}

function ObserverIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="7" cy="9.5" r="1.4" />
      <path d="M7 8V4M4.5 6.5a3.5 3.5 0 0 1 5 0M2.7 4.7a6 6 0 0 1 8.6 0" strokeOpacity="0.85" />
    </svg>
  );
}

function TalkersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <path d="M2 3.2h10v6H6.5L4 11.4V9.2H2z" strokeLinejoin="round" />
      <path d="M4.4 5.4h5.2M4.4 7.1h3.2" strokeOpacity="0.7" />
    </svg>
  );
}

function ClockDriftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M7 4v3l2.1 1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="7" cy="7" r="1.7" />
      <circle cx="2.4" cy="3" r="1.3" />
      <circle cx="11.6" cy="3.4" r="1.3" />
      <circle cx="4" cy="12" r="1.3" />
      <circle cx="11" cy="11" r="1.3" />
      <path d="M3.3 3.7 5.6 6M10.4 4 8.4 6M5.2 8.2 4.3 10.7M8.5 8.1 10.2 9.9" strokeOpacity="0.7" />
    </svg>
  );
}

const RANGE_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

interface Props {
  tab: StatsTab;
  onTabChange: (tab: StatsTab) => void;
  range: StatsRange;
  onRangeChange: (range: StatsRange) => void;
}

export function StatsSubHeader({ tab, onTabChange, range, onRangeChange }: Props) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const tabOptions = [
    { value: "mesh", label: t("stats.mesh"), icon: <MeshIcon /> },
    { value: "talkers", label: t("stats.talkers"), icon: <TalkersIcon /> },
    { value: "clockdrift", label: t("stats.clockDrift"), icon: <ClockDriftIcon /> },
    { value: "observer", label: t("stats.observer"), icon: <ObserverIcon /> },
    { value: "graph", label: t("stats.neighbourGraph"), icon: <GraphIcon /> },
  ];
  const tabSelectOptions = tabOptions.map(({ value, label }) => ({ value, label }));
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-bg-surface px-4 py-2.5">
      {/* pills don't scale on a phone as sections grow — swap to a compact dropdown there */}
      {isMobile ? (
        <SelectDropdown
          label={t("stats.section")}
          hideAll
          align="left"
          options={tabSelectOptions}
          value={tab}
          onChange={(v) => onTabChange(v as StatsTab)}
        />
      ) : (
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Segmented
            options={tabOptions}
            value={tab}
            onChange={(v) => onTabChange(v as StatsTab)}
            ariaLabel={t("stats.sectionLabel")}
            size="md"
          />
        </div>
      )}
      {/* graph is topology and clock-drift is each node's latest reading — neither is time-windowed */}
      {tab !== "graph" && tab !== "clockdrift" && (
        <Segmented
          className="shrink-0"
          options={RANGE_OPTIONS}
          value={range}
          onChange={(v) => onRangeChange(v as StatsRange)}
          ariaLabel={t("stats.timeRange")}
        />
      )}
    </div>
  );
}
