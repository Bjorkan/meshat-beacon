import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatCount } from "../../lib/formatters";
import { useChartColors, nodeTypeColor } from "./chartTheme";
import { useStatsOverview, useStatsObservations, usePayloadBreakdown, useTopNodes, useTopObservers, useRadioPresets, useScopes, useNodeTypes } from "./useStats";
import { observationsAreaOption, leaderboardOption, typeBarOption, donutOption, presetBarsOption } from "./chartOptions";
import { Card, ChartCard, StatCard } from "./cards";
import { DataTable, type Column } from "../../components/DataTable";
import { aggregatePresets, formatPreset } from "./transforms";
import type { ObservationPoint, ScopeStats, StatsRange } from "./types";

// The observations endpoint returns one row per hour+iata; collapse to one row per hour (a no-op for a
// single selected region). uniquePackets / activeObservers summed across iatas are approximate.
function aggregateByHour(points: ObservationPoint[]) {
  const byHour = new Map<number, { hour: number; observationCount: number; uniquePackets: number; activeObservers: number }>();
  for (const p of points) {
    const cur = byHour.get(p.hour) ?? { hour: p.hour, observationCount: 0, uniquePackets: 0, activeObservers: 0 };
    cur.observationCount += p.observationCount;
    cur.uniquePackets += p.uniquePackets;
    cur.activeObservers += p.activeObservers;
    byHour.set(p.hour, cur);
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

interface MeshTabProps {
  range: StatsRange;
  onSelectObserver: (observerId: string) => void;
}

function scopeColumns(t: TFunction): Column<ScopeStats>[] {
  return [
    {
      header: "Scope",
      size: 40,
      cell: (scope) => <span className="text-text-normal">{scope.name}</span>,
      sortValue: (scope) => scope.name,
    },
    {
      header: "Packets",
      label: t("stats.packets"),
      className: (scope) => `text-right tabular-nums ${scope.packetCount === 0 ? "text-text-dim" : "text-text-bright"}`,
      cell: (scope) => formatCount(scope.packetCount),
      sortValue: (scope) => scope.packetCount,
    },
    {
      header: "Observers",
      label: t("stats.observers"),
      className: (scope) => `text-right tabular-nums ${scope.observerCount === 0 ? "text-text-dim" : "text-text-normal"}`,
      cell: (scope) => formatCount(scope.observerCount),
      sortValue: (scope) => scope.observerCount,
    },
    {
      header: "Nodes",
      label: t("stats.nodes"),
      className: (scope) => `text-right tabular-nums ${scope.nodeCount === 0 ? "text-text-dim" : "text-text-normal"}`,
      cell: (scope) => formatCount(scope.nodeCount),
      sortValue: (scope) => scope.nodeCount,
    },
  ];
}

export function MeshTab({ range, onSelectObserver }: MeshTabProps) {
  const { t } = useTranslation();
  const colors = useChartColors();
  const overview = useStatsOverview();
  const observations = useStatsObservations(range);
  // top-row KPIs are a fixed 24h snapshot, so their sparklines use a dedicated
  // 24h series rather than the range-driven one (deduped by query key when range is 24h)
  const overviewObs = useStatsObservations("24h");
  const payload = usePayloadBreakdown(range);
  const topNodes = useTopNodes(10);
  const topObservers = useTopObservers(range, 8);
  const radioPresets = useRadioPresets();
  const scopes = useScopes();
  const nodeTypes = useNodeTypes();

  const obs = useMemo(() => aggregateByHour(observations.data ?? []), [observations.data]);
  const obsOption = useMemo(() => observationsAreaOption(obs, colors, {
    observations: t("stats.observations"),
    uniquePackets: t("stats.uniquePackets"),
  }), [obs, colors, t]);

  const nodeRows = useMemo(
    () =>
      (topNodes.data ?? []).map((n) => ({
        name: n.nodeName ?? n.nodeId.slice(0, 8),
        value: n.observationCount,
        color: nodeTypeColor(n.nodeTypeName, colors),
      })),
    [topNodes.data, colors],
  );
  const nodesOption = useMemo(() => leaderboardOption(nodeRows, colors), [nodeRows, colors]);

  const payloadItems = useMemo(
    () =>
      (payload.data ?? [])
        .map((p) => ({ name: p.payloadTypeName.toLowerCase(), value: p.count }))
        .sort((a, b) => b.value - a.value),
    [payload.data],
  );
  const payloadTotal = useMemo(() => payloadItems.reduce((a, p) => a + p.value, 0), [payloadItems]);
  const payloadOption = useMemo(() => typeBarOption(payloadItems, colors), [payloadItems, colors]);

  const observerRows = useMemo(
    () => (topObservers.data ?? []).map((o) => ({ name: o.displayName ?? o.observerId.slice(0, 8), value: o.observationCount, color: colors.secondary })),
    [topObservers.data, colors],
  );
  const observersOption = useMemo(() => leaderboardOption(observerRows, colors), [observerRows, colors]);
  const observerIds = useMemo(() => (topObservers.data ?? []).map((o) => o.observerId), [topObservers.data]);
  const observerEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const idx = (params as { dataIndex?: number }).dataIndex;
        if (idx != null && observerIds[idx]) onSelectObserver(observerIds[idx]);
      },
    }),
    [observerIds, onSelectObserver],
  );

  const typeRows = useMemo(
    () =>
      [...(nodeTypes.data ?? [])]
        .sort((a, b) => b.count - a.count)
        .map((t) => ({ name: t.nodeTypeName, value: t.count, color: nodeTypeColor(t.nodeTypeName, colors) })),
    [nodeTypes.data, colors],
  );
  const typeTotal = useMemo(() => typeRows.reduce((a, t) => a + t.value, 0), [typeRows]);
  const typesOption = useMemo(() => donutOption(typeRows, colors, formatCount(typeTotal), t("stats.nodes").toUpperCase()), [typeRows, colors, typeTotal, t]);

  const presetRows = useMemo(
    () => aggregatePresets(radioPresets.data ?? []).slice(0, 8).map((r) => ({ name: formatPreset(r.preset), nodes: r.nodes, observers: r.observers })),
    [radioPresets.data],
  );
  const presetsOption = useMemo(() => presetBarsOption(presetRows, colors, undefined, {
    nodes: t("stats.nodes"),
    observers: t("stats.observers"),
  }), [presetRows, colors, t]);

  const scopeRows = useMemo(
    () => [...(scopes.data ?? [])].sort((a, b) => b.packetCount - a.packetCount),
    [scopes.data],
  );
  const scopeTableColumns = useMemo(() => scopeColumns(t), [t]);

  const kpiObs = useMemo(() => aggregateByHour(overviewObs.data ?? []), [overviewObs.data]);
  const obsSpark = useMemo(() => kpiObs.slice(-24).map((p) => p.observationCount), [kpiObs]);
  const observerSpark = useMemo(() => kpiObs.slice(-24).map((p) => p.activeObservers), [kpiObs]);

  const ov = overview.data;
  const kpiLoading = overview.isLoading;
  // top-row KPIs are the overview endpoint's fixed 24h snapshot; range only drives the charts below
  const ovWindow = `${ov?.windowHours ?? 24}h`;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-3.5 px-4 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("stats.totalPackets")} sublabel={ovWindow} accent="var(--color-primary)" value={kpiLoading ? "—" : formatCount(ov?.totalPackets)} />
        <StatCard label={t("stats.observations")} sublabel={ovWindow} accent="var(--color-green)" value={kpiLoading ? "—" : formatCount(ov?.totalObservations)} spark={obsSpark} />
        <StatCard label={t("stats.activeObservers")} sublabel={ovWindow} accent="var(--color-secondary)" value={kpiLoading ? "—" : (ov?.activeObservers ?? "—")} spark={observerSpark} />
        <StatCard label={t("stats.activeIatas")} sublabel={ovWindow} accent="var(--color-warn)" value={kpiLoading ? "—" : (ov?.activeIatas ?? "—")} />
      </div>

      <ChartCard
        title={`${t("stats.observations")} · ${range}`}
        height={200}
        option={obsOption}
        isLoading={observations.isLoading}
        isError={observations.isError}
        isEmpty={obs.length === 0}
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {/* range-driven charts lead the grid; the all-time ones follow below */}
        <ChartCard title={t("stats.topObservers", { range })} height={208} option={observersOption} isLoading={topObservers.isLoading} isError={topObservers.isError} isEmpty={observerRows.length === 0} onEvents={observerEvents} />
        <ChartCard
          title={t("stats.payloadTypes", { range })}
          right={<span className="font-mono text-[10px] text-text-muted">{formatCount(payloadTotal)} obs</span>}
          height={208}
          option={payloadOption}
          isLoading={payload.isLoading}
          isError={payload.isError}
          isEmpty={payloadItems.length === 0}
        />
        {/* counts are all-time; the server's 7d filter only prunes the roster to recently-heard nodes */}
        <ChartCard title={t("stats.topNodesAllTime")} height={208} option={nodesOption} isLoading={topNodes.isLoading} isError={topNodes.isError} isEmpty={nodeRows.length === 0} />
        <ChartCard title={t("stats.nodeTypesAllTime")} height={208} option={typesOption} isLoading={nodeTypes.isLoading} isError={nodeTypes.isError} isEmpty={typeRows.length === 0} />
        <ChartCard title={t("stats.radioPresetsAllTime")} height={208} option={presetsOption} isLoading={radioPresets.isLoading} isError={radioPresets.isError} isEmpty={presetRows.length === 0} />

        <Card title={t("stats.scopesAllTime")}>
          {scopes.isError ? (
            <div className="py-4 text-center font-mono text-[11px] text-text-dim">{t("common.failedToLoad")}</div>
          ) : scopes.isLoading ? (
            <div className="py-4 text-center font-mono text-[11px] text-text-dim">{t("common.loading")}</div>
          ) : scopeRows.length === 0 ? (
            <div className="py-4 text-center font-mono text-[11px] text-text-dim">{t("common.noData")}</div>
          ) : (
            <DataTable
              columns={scopeTableColumns}
              rows={scopeRows}
              rowKey={(scope) => scope.name}
              selectedKey={null}
              onSelect={() => {}}
              emptyLabel={t("common.noData")}
              defaultSort={{ header: "Packets", direction: "desc" }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
