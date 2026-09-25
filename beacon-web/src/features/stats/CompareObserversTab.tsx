import { t } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { getObserver, getObserverComparison, getObserversPage } from '../../api/client';
import { useRegion } from '../../hooks/useRegion';
import { Card } from './cards';

type Selection = { observerA: string; observerB: string; since: number; until: number };
const uuid =
  /^(?!00000000-0000-0000-0000-000000000000$)[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const fieldClass =
  'min-w-0 w-full rounded border border-border bg-bg-base px-2.5 py-2 text-base text-text-normal';

function validation(value: Selection): string | null {
  if (
    !uuid.test(value.observerA) ||
    !uuid.test(value.observerB) ||
    value.observerA.toLowerCase() === value.observerB.toLowerCase()
  ) {
    return t('upstream.choose_two_different_observers');
  }
  if (
    !Number.isSafeInteger(value.since) ||
    !Number.isSafeInteger(value.until) ||
    value.since < 0 ||
    value.until <= value.since ||
    value.until > 253402300799999
  ) {
    return t('upstream.choose_a_valid_start_and_a_later_end_time');
  }
  return null;
}

function localTime(ms: number) {
  const date = new Date(ms);
  return new Date(ms - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

function ObserverSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { iatas, regionKey, isResolved } = useRegion();
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setName(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const options = useQuery({
    queryKey: ['comparison-observers', regionKey, name],
    queryFn: () => getObserversPage(iatas, { name: name || undefined, limit: 50 }),
    staleTime: 30_000,
    enabled: isResolved !== false,
  });
  const selected = useQuery({
    queryKey: ['observer', value],
    queryFn: () => getObserver(value),
    enabled: uuid.test(value),
    staleTime: 30_000,
    retry: false,
  });
  const rows = options.data?.items ?? [];
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-sm text-text-muted">{label}</legend>
      <input
        type="search"
        aria-label={t('charts.searchObserver', { label })}
        placeholder={t('upstream.search_all_observers_by_name')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={fieldClass}
      />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={fieldClass}
      >
        <option value="">{t('upstream.choose_an_observer')}</option>
        {value && !rows.some((o) => o.id === value) && (
          <option value={value}>{selected.data?.displayName ?? value}</option>
        )}
        {rows.map((o) => (
          <option key={o.id} value={o.id}>
            {o.displayName ?? o.id.slice(0, 8)} · {o.iata} · {o.id.slice(0, 8)}
          </option>
        ))}
      </select>
      <p className="text-xs text-text-dim" role="status">
        {options.isPending
          ? t('upstream.loading_observers')
          : options.isError
            ? t('upstream.observer_search_failed_try_again')
            : options.data?.hasMore
              ? t('upstream.showing_50_observers_search_to_find_others')
              : rows.length === 0
                ? t('upstream.no_observers_match_this_search')
                : t('upstream.search_includes_all_matching_observers_in_the_selected_region')}
      </p>
      {options.isError && (
        <button
          type="button"
          onClick={() => void options.refetch()}
          className="text-sm text-primary"
        >
          {t('upstream.retry_observer_search')}
        </button>
      )}
    </fieldset>
  );
}

function ComparisonForm({
  initial,
  onCompare,
}: {
  initial: Selection | null;
  onCompare: (value: Selection) => void;
}) {
  const { t } = useTranslation();
  const [a, setA] = useState(initial?.observerA ?? '');
  const [b, setB] = useState(initial?.observerB ?? '');
  const [since, setSince] = useState(() =>
    localTime(initial?.since ?? Math.floor((Date.now() - 86_400_000) / 60_000) * 60_000),
  );
  const [until, setUntil] = useState(() =>
    localTime(initial?.until ?? Math.floor(Date.now() / 60_000) * 60_000),
  );
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const value = {
      observerA: a.toLowerCase(),
      observerB: b.toLowerCase(),
      since: new Date(since).getTime(),
      until: new Date(until).getTime(),
    };
    const message = validation(value);
    setError(message);
    if (!message) onCompare(value);
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <ObserverSelect label={t('upstream.observer_a')} value={a} onChange={setA} />
        <ObserverSelect label={t('upstream.observer_b')} value={b} onChange={setB} />
        <label className="min-w-0 space-y-2 text-sm text-text-muted">
          <span>{t('upstream.start_local_time')}</span>
          <input
            type="datetime-local"
            step="0.001"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="min-w-0 space-y-2 text-sm text-text-muted">
          <span>{t('upstream.end_local_time')}</span>
          <input
            type="datetime-local"
            step="0.001"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="rounded border border-primary-dim bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
      >
        {t('upstream.compare')}
      </button>
    </form>
  );
}

export function CompareObserversTab() {
  const { t } = useTranslation();
  const { iatas, regionKey, isResolved } = useRegion();
  const search = useSearch({ from: '/analytics' });
  const navigate = useNavigate({ from: '/analytics' });
  const params = new URLSearchParams();
  for (const key of ['compareA', 'compareB', 'compareSince', 'compareUntil'] as const) {
    if (search[key] !== undefined) params.set(key, search[key]);
  }
  const keys = ['compareA', 'compareB', 'compareSince', 'compareUntil'];
  const supplied = keys.some((key) => params.has(key));
  const parsed: Selection = {
    observerA: params.get('compareA') ?? '',
    observerB: params.get('compareB') ?? '',
    since: Number(params.get('compareSince')),
    until: Number(params.get('compareUntil')),
  };
  const valid =
    keys.every((key) => params.getAll(key).length === 1 && params.get(key) !== '') &&
    !validation(parsed);
  const selection = valid ? parsed : null;
  const result = useQuery({
    queryKey: ['observer-comparison', regionKey, selection],
    queryFn: ({ signal }) => getObserverComparison(iatas, selection!, signal),
    enabled: selection !== null && isResolved !== false,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const observerA = useQuery({
    queryKey: ['observer', selection?.observerA],
    queryFn: () => getObserver(selection!.observerA),
    enabled: selection !== null && isResolved !== false,
    staleTime: 30_000,
    retry: false,
  });
  const observerB = useQuery({
    queryKey: ['observer', selection?.observerB],
    queryFn: () => getObserver(selection!.observerB),
    enabled: selection !== null && isResolved !== false,
    staleTime: 30_000,
    retry: false,
  });
  function compare(value: Selection) {
    if (
      selection &&
      Object.entries(value).every(([key, v]) => selection[key as keyof Selection] === v)
    ) {
      void result.refetch();
      return;
    }
    void navigate({
      search: (old) => ({
        ...old,
        compareA: value.observerA,
        compareB: value.observerB,
        compareSince: String(value.since),
        compareUntil: String(value.until),
      }),
    });
  }
  const data = result.data;
  const groups = data
    ? [
        { name: t('upstream.only_a'), count: data.onlyA, color: 'var(--color-primary)' },
        { name: t('upstream.both'), count: data.both, color: 'var(--color-green)' },
        { name: t('upstream.only_b'), count: data.onlyB, color: 'var(--color-secondary)' },
      ]
    : [];
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <Card title={t('upstream.compare_observers')}>
        <p className="mb-4 text-sm text-text-muted">
          {t('upstream.compare_distinct_flood_packets_reported_by_two_observers_over')}
        </p>
        {supplied && !valid && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {t('upstream.this_comparison_link_has_invalid_or_missing_values_choose')}
          </p>
        )}
        <ComparisonForm
          key={keys.map((key) => params.get(key)).join('|')}
          initial={selection}
          onCompare={compare}
        />
      </Card>
      {selection && (
        <Card title={t('upstream.reported_flood_packets')}>
          <p className="mb-2 break-words text-sm text-text-normal">
            A: {observerA.data?.displayName ?? selection.observerA} · B:{' '}
            {observerB.data?.displayName ?? selection.observerB}
          </p>
          <p className="mb-3 break-words text-sm text-text-muted">
            {new Date(selection.since).toLocaleString()}
            {t('upstream.to')} {new Date(selection.until).toLocaleString()}
            {t('upstream.local_time_end_excluded_region')} {iatas?.join(', ') || t('charts.all')}.
          </p>
          {result.isFetching && (
            <p role="status" className="text-sm text-text-muted">
              {t('upstream.comparing_reported_packets')}
            </p>
          )}
          {result.isError && (
            <div role="alert" className="text-sm text-danger">
              <p>{result.error.message}</p>
              <button
                type="button"
                onClick={() => void result.refetch()}
                className="mt-2 text-primary"
              >
                {t('upstream.retry_comparison')}
              </button>
            </div>
          )}
          {data && !result.isError && (
            <>
              <p className="mb-3 text-lg font-semibold text-text-bright">
                {data.totalPackets.toLocaleString()}
                {t('upstream.distinct_flood_packets')}
              </p>
              {data.totalPackets === 0 ? (
                <p className="text-sm text-text-muted">
                  {t('upstream.no_flood_packets_were_reported_by_either_observer_in')}
                </p>
              ) : (
                <>
                  <div aria-hidden className="mb-4 flex h-5 overflow-hidden rounded">
                    {groups.map((g) => (
                      <div
                        key={g.name}
                        style={{
                          width: `${(g.count / data.totalPackets) * 100}%`,
                          background: g.color,
                        }}
                      />
                    ))}
                  </div>
                  <table
                    className="w-full text-left text-sm tabular-nums"
                    aria-label={t('upstream.flood_packet_comparison')}
                  >
                    <thead className="text-text-muted">
                      <tr>
                        <th scope="col">{t('upstream.heard_by')}</th>
                        <th scope="col" className="text-right">
                          {t('upstream.packets')}
                        </th>
                        <th scope="col" className="text-right">
                          {t('upstream._of_union')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <tr key={g.name} className="border-t border-border">
                          <th scope="row" className="py-2 font-normal text-text-normal">
                            <span
                              aria-hidden
                              className="mr-2 inline-block h-2 w-2 rounded-full"
                              style={{ background: g.color }}
                            />
                            {g.name}
                          </th>
                          <td className="text-right">{g.count.toLocaleString()}</td>
                          <td className="text-right">
                            {((g.count / data.totalPackets) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <p className="mt-4 text-xs text-text-dim">
                {t('upstream.percentages_use_the_union_of_packets_heard_by_either')}
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
