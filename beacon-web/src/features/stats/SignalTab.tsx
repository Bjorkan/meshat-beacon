import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { formatCount } from '../../lib/formatters';
import { Card, ChartCard, StatCard } from './cards';
import { useChartColors } from './chartTheme';
import {
  signalBinLabel,
  signalCoverageOption,
  signalHistogramOption,
  signalHours,
  signalTrendOption,
} from './signal';
import { useSignalStats } from './useSignalStats';
import type { StatsRange } from './types';

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const average = (value: number | null | undefined, unit = '') =>
  value == null ? '—' : `${value.toFixed(1)}${unit ? ` ${unit}` : ''}`;

export function SignalTab({ range }: { range: StatsRange }) {
  const { t } = useTranslation();
  const query = useSignalStats(range);
  const c = useChartColors();
  const loading = query.isPending || query.isPlaceholderData;
  const data = loading || query.isError ? undefined : query.data;
  const hours = useMemo(() => signalHours(data), [data]);
  const charts = useMemo(
    () => ({
      snr: signalHistogramOption(data?.snr, 'SNR', 'dB', c, t),
      rssi: signalHistogramOption(data?.rssi, 'RSSI', 'dBm', c, t),
      snrTrend: signalTrendOption(hours, 'snr', c, t),
      rssiTrend: signalTrendOption(hours, 'rssi', c, t),
      coverage: signalCoverageOption(data, c, t),
    }),
    [data, hours, c, t],
  );
  const state = { isLoading: loading, isError: query.isError };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1200px] flex-col gap-3.5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright">{t('upstream.rf_signal')}</h2>
          <p className="text-sm text-text-muted">
            {t('upstream.the_signal_behind_reported_receptions')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching || query.isPending}
          className="rounded border border-border px-3 py-1.5 text-xs text-text-normal hover:bg-bg-raised disabled:opacity-50"
        >
          {t('upstream.refresh_signal')}
        </button>
      </div>
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('upstream.could_not_load_signal_data_try_refreshing_or_choosing')}
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
          label={t('upstream.mean_snr')}
          value={
            <span className="whitespace-nowrap text-base sm:text-2xl">
              {average(data?.snr.average, 'dB')}
            </span>
          }
          accent={c.secondary}
        />
        <StatCard
          label={t('upstream.mean_rssi')}
          value={
            <span className="whitespace-nowrap text-base sm:text-2xl">
              {average(data?.rssi.average, 'dBm')}
            </span>
          }
          accent={c.green}
        />
        <StatCard
          label={t('upstream.hours_with_records')}
          value={data ? `${data.hourly.length}/${hours.length}` : '—'}
          accent={c.warn}
        />
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {t('upstream.signal_measured_by_observers_on_the_last_hop_charts')}
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
          title={t('upstream.snr_distribution_db')}
          option={charts.snr}
          height={280}
          isEmpty={!data?.snr.samples}
          {...state}
        />
        <ChartCard
          title={t('upstream.rssi_distribution_dbm')}
          option={charts.rssi}
          height={280}
          isEmpty={!data?.rssi.samples}
          {...state}
        />
        <ChartCard
          title={t('upstream.hourly_mean_snr_db')}
          option={charts.snrTrend}
          height={230}
          isEmpty={!data?.snr.samples}
          {...state}
        />
        <ChartCard
          title={t('upstream.hourly_mean_rssi_dbm')}
          option={charts.rssiTrend}
          height={230}
          isEmpty={!data?.rssi.samples}
          {...state}
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title={t('upstream.sample_availability')}
          option={charts.coverage}
          height={150}
          isEmpty={!data?.receptions}
          {...state}
        />
        <Card title={t('upstream.what_the_averages_include')}>
          {!data ? (
            <p className="py-4 text-sm text-text-muted">
              {query.isError ? t('upstream.data_unavailable') : t('upstream.loading_signal')}
            </p>
          ) : !data.receptions ? (
            <p className="py-4 text-sm text-text-muted">
              {t('upstream.no_retained_receptions_in_this_window')}
            </p>
          ) : (
            <table
              aria-label={t('upstream.signal_sample_availability')}
              className="w-full text-left font-mono text-xs"
            >
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-2">
                    {t('upstream.metric')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('upstream.samples')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('upstream.missing')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('upstream.share')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(['snr', 'rssi'] as const).map((metric) => (
                  <tr key={metric} className="border-t border-border-subtle">
                    <th scope="row" className="py-3 text-text-normal">
                      {metric.toUpperCase()}
                    </th>
                    <td className="text-right text-text-bright">
                      {data[metric].samples.toLocaleString()}
                    </td>
                    <td className="text-right text-text-muted">
                      {(data.receptions - data[metric].samples).toLocaleString()}
                    </td>
                    <td className="text-right text-text-muted">
                      {((100 * data[metric].samples) / data.receptions).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            {t('upstream.each_mean_weights_every_available_reception_equally_missing_includes')}
          </p>
        </Card>
      </div>
      {data && data.receptions > 0 && (
        <details className="rounded-lg border border-border bg-bg-surface p-3.5">
          <summary className="cursor-pointer text-sm font-semibold text-text-normal">
            {t('upstream.exact_histogram_and_hourly_values')}
          </summary>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(['snr', 'rssi'] as const).map((metric) => (
              <table
                key={metric}
                aria-label={`${metric.toUpperCase()} histogram`}
                className="w-full text-left font-mono text-xs"
              >
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col" className="py-2">
                      {metric.toUpperCase()} · {metric === 'snr' ? 'dB' : 'dBm'}
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.samples')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data[metric].histogram.map((bin, i) => (
                    <tr key={i} className="border-t border-border-subtle">
                      <th scope="row" className="py-1.5 font-normal text-text-normal">
                        {signalBinLabel(bin)}
                      </th>
                      <td className="text-right text-text-bright">{bin.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
          <p className="my-3 text-xs text-text-muted">
            {t('upstream.bins_include_the_lower_bound_and_exclude_the_upper')}
          </p>
          <div className="max-h-[340px] overflow-auto">
            <table
              aria-label={t('upstream.hourly_signal_values')}
              className="w-full min-w-[540px] text-left font-mono text-xs"
            >
              <thead className="text-text-muted">
                <tr>
                  <th scope="col" className="py-2">
                    {t('upstream.utc_hour')}
                  </th>
                  <th scope="col">{t('upstream.receptions')}</th>
                  <th scope="col">{t('upstream.snr_samples')}</th>
                  <th scope="col">{t('upstream.mean_db')}</th>
                  <th scope="col">{t('upstream.rssi_samples')}</th>
                  <th scope="col">{t('upstream.mean_dbm')}</th>
                </tr>
              </thead>
              <tbody>
                {data.hourly.map((row) => (
                  <tr key={row.hour} className="border-t border-border-subtle">
                    <th scope="row" className="py-2 font-normal text-text-normal">
                      {utc(row.hour)}
                    </th>
                    <td>{row.receptions.toLocaleString()}</td>
                    <td>{row.snrSamples.toLocaleString()}</td>
                    <td>{average(row.snrAverage)}</td>
                    <td>{row.rssiSamples.toLocaleString()}</td>
                    <td>{average(row.rssiAverage)}</td>
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
