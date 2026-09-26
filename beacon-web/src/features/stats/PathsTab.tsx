import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { formatCount } from '../../lib/formatters';
import { Card, ChartCard, StatCard } from './cards';
import { donutOption } from './chartOptions';
import { tooltipStyle, useChartColors } from './chartTheme';
import { pathHours, pathLengthOption, pathTrendOption } from './paths';
import { usePathStats } from './usePathStats';
import type { StatsRange } from './types';

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

export function PathsTab({ range }: { range: StatsRange }) {
  const { t } = useTranslation();
  const query = usePathStats(range),
    c = useChartColors();
  const loading = query.isPending || query.isPlaceholderData;
  const data = loading || query.isError ? undefined : query.data;
  const hours = useMemo(() => pathHours(data), [data]);
  const categories = useMemo(
    () => [
      { name: t('upstream.hash_paths'), value: data?.hashed ?? 0, color: c.primary },
      { name: t('upstream.empty'), value: data?.empty ?? 0, color: c.textDim },
      { name: t('upstream.trace'), value: data?.trace ?? 0, color: c.warn },
      { name: t('upstream.unclassified'), value: data?.unclassified ?? 0, color: c.secondary },
    ],
    [data, c, t],
  );
  const charts = useMemo(() => {
    const width = donutOption(
      (data?.hashWidths ?? []).map((bin, i) => ({
        name: `${bin.bytes}-byte`,
        value: bin.receptions,
        color: c.series[i],
      })),
      c,
      formatCount(data?.hashed ?? 0),
      t('upstream.hash_paths'),
    );
    const coverage = donutOption(
      categories,
      c,
      formatCount(data?.receptions ?? 0),
      t('charts.receptions').toLocaleUpperCase(),
    );
    return {
      width: {
        ...width,
        tooltip: {
          trigger: 'item' as const,
          renderMode: 'richText' as const,
          formatter: '{b}: {c} ({d}%)',
          ...tooltipStyle(c),
        },
        aria: {
          enabled: true,
          label: {
            description: t(
              'upstream.hashwidth_share_among_nonempty_ordinary_paths_empty_trace_and',
            ),
          },
        },
      },
      coverage: {
        ...coverage,
        tooltip: {
          trigger: 'item' as const,
          renderMode: 'richText' as const,
          formatter: '{b}: {c} ({d}%)',
          ...tooltipStyle(c),
        },
        aria: {
          enabled: true,
          label: {
            description: t(
              'upstream.path_classification_for_all_retained_receptions_the_four_categories',
            ),
          },
        },
      },
      lengths: pathLengthOption(data?.pathLengths ?? [], c, t),
      trend: pathTrendOption(hours, c, t),
    };
  }, [data, c, categories, hours, t]);
  const state = { isLoading: loading, isError: query.isError };
  const multi =
    data?.hashWidths.filter((bin) => bin.bytes > 1).reduce((n, bin) => n + bin.receptions, 0) ?? 0;
  const largest = data?.pathLengths.at(-1)?.entries;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1200px] flex-col gap-3.5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright">{t('upstream.paths_hashes')}</h2>
          <p className="text-sm text-text-muted">
            {t('upstream.how_received_packets_carry_route_hashes')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching || query.isPending}
          className="rounded border border-border px-3 py-1.5 text-xs text-text-normal hover:bg-bg-raised disabled:opacity-50"
        >
          {t('upstream.refresh_paths')}
        </button>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('upstream.could_not_load_path_data_try_refreshing_or_choosing')}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('upstream.reported_receptions')}
          value={data ? formatCount(data.receptions) : '—'}
          accent={c.primary}
          sublabel={range}
        />
        <StatCard
          label={t('upstream.with_hash_paths')}
          value={data ? formatCount(data.hashed) : '—'}
          accent={c.green}
        />
        <StatCard
          label={t('upstream.multibyte_share')}
          value={data?.hashed ? `${((100 * multi) / data.hashed).toFixed(1)}%` : '—'}
          accent={c.secondary}
        />
        <StatCard label={t('upstream.most_path_entries')} value={largest ?? '—'} accent={c.warn} />
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {t('upstream.path_entries_reported_by_observers_counted_per_reception_hashwidth')}
      </p>
      {data && (
        <p className="text-xs text-text-muted">
          {t('upstream.window')}
          {utc(data.since)}
          {t('upstream.to')}
          {utc(data.until)}
          {t('upstream.utc_end_exclusive_completehour_snapshots_refresh_in_the_background')}
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title={t('upstream.observed_hash_widths')}
          option={charts.width}
          height={260}
          isEmpty={!data?.hashed}
          {...state}
        />
        <ChartCard
          title={t('upstream.received_path_entries')}
          option={charts.lengths}
          height={260}
          isEmpty={!data || data.hashed + data.empty === 0}
          {...state}
        />
      </div>
      <ChartCard
        title={t('upstream.hashpath_receptions_over_time')}
        option={charts.trend}
        height={260}
        isEmpty={!data?.hashed}
        {...state}
      />
      <div className="grid min-w-0 grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title={t('upstream.path_format_coverage')}
          option={charts.coverage}
          height={260}
          isEmpty={!data?.receptions}
          {...state}
        />
        <Card title={t('upstream.what_the_counts_include')}>
          {!data ? (
            <p className="py-4 text-sm text-text-muted">
              {query.isError ? t('upstream.data_unavailable') : t('upstream.loading_paths')}
            </p>
          ) : !data.receptions ? (
            <p className="py-4 text-sm text-text-muted">
              {t('upstream.no_retained_receptions_in_this_window')}
            </p>
          ) : (
            <table
              aria-label={t('upstream.path_classification_counts')}
              className="w-full text-left font-mono text-xs"
            >
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-2">
                    {t('upstream.category')}
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
                {categories.map((item) => (
                  <tr key={item.name} className="border-t border-border-subtle">
                    <th scope="row" className="py-2 font-normal text-text-normal">
                      {item.name}
                    </th>
                    <td className="text-right text-text-bright">{item.value.toLocaleString()}</td>
                    <td className="text-right text-text-muted">
                      {((100 * item.value) / data.receptions).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            {t('upstream.flood_paths_accumulate_entries_direct_routes_contain_remaining_entries')}
          </p>
        </Card>
      </div>
      {data && data.receptions > 0 && (
        <details className="rounded-lg border border-border bg-bg-surface p-3.5">
          <summary className="cursor-pointer text-sm font-semibold text-text-normal">
            {t('upstream.exact_width_pathlength_and_hourly_values')}
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <table
              aria-label={t('upstream.hash_width_counts')}
              className="w-full text-left font-mono text-xs"
            >
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-2">
                    {t('upstream.bytes_per_hash')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('upstream.receptions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.hashWidths.map((bin) => (
                  <tr key={bin.bytes} className="border-t border-border-subtle">
                    <th scope="row" className="py-1.5 font-normal">
                      {bin.bytes}
                    </th>
                    <td className="text-right">{bin.receptions.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="max-h-[230px] overflow-auto">
              <table
                aria-label={t('upstream.path_entry_counts')}
                className="w-full text-left font-mono text-xs"
              >
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col" className="py-2">
                      {t('upstream.header_entries')}
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.receptions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.pathLengths.map((bin) => (
                    <tr key={bin.entries} className="border-t border-border-subtle">
                      <th scope="row" className="py-1.5 font-normal">
                        {bin.entries}
                      </th>
                      <td className="text-right">{bin.receptions.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="my-3 text-xs text-text-muted">
            {t('upstream.length_counts_include_validated_ordinary_empty_paths_at_zero')}
          </p>
          <div className="max-h-[340px] overflow-auto">
            <table
              aria-label={t('upstream.hourly_path_counts')}
              className="w-full min-w-[650px] text-left font-mono text-xs"
            >
              <thead className="text-text-muted">
                <tr>
                  {[
                    t('upstream.utc_hour'),
                    t('upstream.receptions'),
                    '1-byte',
                    '2-byte',
                    '3-byte',
                    t('upstream.empty'),
                    t('upstream.trace'),
                    t('upstream.unclassified'),
                  ].map((label) => (
                    <th key={label} scope="col" className="py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.hourly.map((row) => (
                  <tr key={row.hour} className="border-t border-border-subtle">
                    <th scope="row" className="py-2 font-normal">
                      {utc(row.hour)}
                    </th>
                    {[
                      row.receptions,
                      row.oneByte,
                      row.twoByte,
                      row.threeByte,
                      row.empty,
                      row.trace,
                      row.unclassified,
                    ].map((n, i) => (
                      <td key={i}>{n.toLocaleString()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
