import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useScopes } from './useStats';
import { useChartColors } from './chartTheme';
import { Card, ChartCard, StatCard } from './cards';
import { scopeChartOption, scopeSummary } from './scopes';
import { formatCount } from '../../lib/formatters';

export function ScopesTab() {
  const { t } = useTranslation();
  const query = useScopes();
  const colors = useChartColors();
  const [search, setSearch] = useState('');
  const loading = query.isPending || query.isLoading || query.isPlaceholderData;
  const unavailable = loading || query.isError;
  const all = useMemo(() => (unavailable ? [] : (query.data ?? [])), [query.data, unavailable]);
  const rows = useMemo(
    () =>
      all
        .filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => b.packetCount - a.packetCount || a.name.localeCompare(b.name)),
    [all, search],
  );
  const totals = useMemo(() => scopeSummary(rows), [rows]);
  const packets = useMemo(
    () => scopeChartOption(rows, 'packetCount', colors, t),
    [rows, colors, t],
  );
  const observers = useMemo(
    () => scopeChartOption(rows, 'observerCount', colors, t),
    [rows, colors, t],
  );
  const nodes = useMemo(() => scopeChartOption(rows, 'nodeCount', colors, t), [rows, colors, t]);
  const value = (number: number) => (unavailable ? '—' : formatCount(number));
  const height = Math.max(180, Math.min(13, rows.length) * 28 + 16);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1200px] flex-col gap-3.5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-bright">
            {t('upstream.transport_scopes')}
          </h2>
          <p className="text-sm text-text-muted">
            {t('upstream.retained_data_and_memberships_for_the_selected_region')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching || query.isPending}
          className="rounded border border-border px-3 py-1.5 text-xs text-text-normal hover:bg-bg-raised disabled:opacity-50"
        >
          {t('upstream.refresh_scopes')}
        </button>
      </div>
      <label className="flex max-w-sm flex-col gap-1 text-xs text-text-muted">
        {t('upstream.find_a_scope')}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="#bc, #east…"
          className="rounded border border-border bg-bg-raised px-3 py-2 text-base text-text-bright outline-none focus:border-primary sm:text-sm"
        />
      </label>
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('upstream.could_not_load_scopes_try_refreshing')}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('upstream.scopes_with_data')}
          value={value(totals.active)}
          accent={colors.secondary}
        />
        <StatCard
          label={t('upstream.scoped_packets')}
          value={value(totals.packets)}
          accent={colors.primary}
        />
        <StatCard
          label={t('upstream.observer_memberships')}
          value={value(totals.memberships)}
          accent={colors.green}
        />
        <StatCard
          label={t('upstream.defaultscope_nodes')}
          value={value(totals.nodes)}
          accent={colors.warn}
        />
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {t('upstream.an_observer_can_appear_in_more_than_one_scope')}
      </p>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <ChartCard
          title={t('upstream.packets_by_scope')}
          option={packets}
          height={height}
          isLoading={loading}
          isError={query.isError}
          isEmpty={!totals.packets}
        />
        <ChartCard
          title={t('upstream.observer_memberships_by_scope')}
          option={observers}
          height={height}
          isLoading={loading}
          isError={query.isError}
          isEmpty={!totals.memberships}
        />
        <ChartCard
          title={t('upstream.defaultscope_nodes')}
          option={nodes}
          height={height}
          isLoading={loading}
          isError={query.isError}
          isEmpty={!totals.nodes}
        />
        <Card
          title={t('upstream.scope_counts')}
          right={
            <span className="text-[10px] text-text-muted">
              {unavailable ? '—' : `${rows.length} of ${all.length} scopes`}
            </span>
          }
        >
          {unavailable ? (
            <p className="py-6 text-sm text-text-muted">
              {query.isError ? t('upstream.data_unavailable') : t('upstream.loading_scopes')}
            </p>
          ) : !rows.length ? (
            <p className="py-6 text-sm text-text-muted">
              {search
                ? t('upstream.no_scopes_match_this_search')
                : t('upstream.no_scope_data_available')}
            </p>
          ) : (
            <div className="max-h-[390px] overflow-auto">
              <table
                aria-label={t('upstream.scope_counts')}
                className="w-full text-left font-mono text-[11px]"
              >
                <thead className="text-text-muted">
                  <tr>
                    <th scope="col" className="py-2">
                      {t('upstream.scope')}
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.packets')}
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.observers')}
                    </th>
                    <th scope="col" className="text-right">
                      {t('upstream.nodes')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name} className="border-t border-border-subtle">
                      <th
                        scope="row"
                        className="max-w-32 break-all py-2 pr-2 font-normal text-text-normal"
                      >
                        {row.name}
                      </th>
                      <td className="text-right tabular-nums text-text-bright">
                        {row.packetCount.toLocaleString()}
                      </td>
                      <td className="text-right tabular-nums text-text-normal">
                        {row.observerCount.toLocaleString()}
                      </td>
                      <td className="text-right tabular-nums text-text-normal">
                        {row.nodeCount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-text-muted">
            {t('upstream.charts_show_the_largest_12_scopes_plus_any_remainder')}
          </p>
        </Card>
      </div>
    </div>
  );
}
