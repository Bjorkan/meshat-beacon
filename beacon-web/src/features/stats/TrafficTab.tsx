import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { formatCount } from '../../lib/formatters';
import { useStatsObservations } from './useStats';
import { tooltipStyle, useChartColors } from './chartTheme';
import { donutOption } from './chartOptions';
import { Card, ChartCard, StatCard } from './cards';
import { trafficModel, trafficHeatmapOption, trafficTrendOption } from './traffic';
import type { StatsRange } from './types';

export function TrafficTab({ range }: { range: StatsRange }) {
  const { t } = useTranslation();
  const query = useStatsObservations(range);
  const colors = useChartColors();
  const loading = query.isPending || query.isLoading || query.isPlaceholderData;
  const unavailable = loading || query.isError;
  const model = useMemo(
    () => trafficModel(unavailable ? [] : (query.data ?? []), range, query.dataUpdatedAt, t),
    [query.data, query.dataUpdatedAt, range, unavailable, t],
  );
  const trend = useMemo(() => trafficTrendOption(model, colors, t), [model, colors, t]);
  const heatmap = useMemo(() => trafficHeatmapOption(model, colors, t), [model, colors, t]);
  const share = useMemo(() => {
    const option = donutOption(
      model.series.map((area, i) => ({
        name: area.name,
        value: area.total,
        color: colors.series[i],
      })),
      colors,
      formatCount(model.total),
      t('charts.receptions').toLocaleUpperCase(),
    );
    return {
      ...option,
      tooltip: { trigger: 'item', renderMode: 'richText', ...tooltipStyle(colors) },
      aria: {
        enabled: true,
        label: {
          description: t('upstream.reception_share_by_iata_exact_counts_and_percentages_follow'),
        },
      },
    };
  }, [model, colors, t]);
  const value = (number: number) => (unavailable ? '—' : formatCount(number));

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1200px] flex-col gap-3.5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright">{t('upstream.traffic')}</h2>
          <p className="text-sm text-text-muted">
            {t('upstream.when_and_where_observers_report_receptions')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching || query.isPending}
          className="rounded border border-border px-3 py-1.5 text-xs text-text-normal hover:bg-bg-raised disabled:opacity-50"
        >
          {t('upstream.refresh_traffic')}
        </button>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('upstream.could_not_load_traffic_try_refreshing')}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('upstream.reported_receptions')}
          value={value(model.total)}
          accent={colors.primary}
          sublabel={range}
        />
        <StatCard
          label={t('upstream.reporting_iatas')}
          value={value(model.areas.filter((area) => area.total > 0).length)}
          accent={colors.green}
        />
        <StatCard
          label={t('upstream.busiest_hour')}
          value={unavailable || !model.peak ? '—' : formatCount(model.peak.total)}
          accent={colors.secondary}
        />
        <StatCard
          label={t('upstream.hours_with_records')}
          value={unavailable ? '—' : `${model.reportedHours}/${model.hours.length}`}
          accent={colors.warn}
        />
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {t('upstream.counts_are_reported_receptions_not_unique_packets_blank_hours')}
      </p>
      <ChartCard
        title={t('upstream.reception_trend_by_iata')}
        right={
          <span className="text-[10px] text-text-muted">
            {t('upstream.available_hourly_records')}
          </span>
        }
        option={trend}
        height={260}
        isLoading={loading}
        isError={query.isError}
        isEmpty={!model.total}
      />
      <ChartCard
        title={t('charts.hourlyActivity', { range })}
        option={heatmap}
        height={Math.max(150, model.days.length * 15 + 72)}
        isLoading={loading}
        isError={query.isError}
        isEmpty={!model.total}
      />
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title={t('upstream.reception_share')}
          option={share}
          height={260}
          isLoading={loading}
          isError={query.isError}
          isEmpty={!model.total}
        />
        <Card title={t('upstream.receptions_by_iata')}>
          {unavailable ? (
            <p className="py-6 text-sm text-text-muted">
              {query.isError ? t('upstream.data_unavailable') : t('upstream.loading_traffic')}
            </p>
          ) : !model.areas.length ? (
            <p className="py-6 text-sm text-text-muted">
              {t('upstream.no_retained_receptions_in_this_window')}
            </p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto">
              <table
                aria-label={t('upstream.receptions_by_iata')}
                className="w-full text-left font-mono text-xs"
              >
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col" className="py-2">
                      IATA
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.receptions')}
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.share')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.areas.map((area, i) => (
                    <tr key={area.name} className="border-t border-border-subtle">
                      <th scope="row" className="py-2 font-normal text-text-normal">
                        <span
                          aria-hidden
                          className="mr-2 inline-block h-2 w-2 rounded-full"
                          style={{ background: colors.series[Math.min(i, 7)] }}
                        />
                        {area.name}
                      </th>
                      <td className="text-right tabular-nums text-text-bright">
                        {area.total.toLocaleString()}
                      </td>
                      <td className="text-right tabular-nums text-text-muted">
                        {(model.total ? (100 * area.total) / model.total : 0).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-text-muted">
            {t('upstream.charts_group_smaller_areas_into_other_iatas_this_table')}
          </p>
        </Card>
      </div>
    </div>
  );
}
