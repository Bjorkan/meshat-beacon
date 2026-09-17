// RoutePlanner: Google-Maps-like best-route planner replacing the old
// observed-routes table. Pick from-node + to-node (name search with
// suggestions), the server computes best-first paths over the global neighbor
// graph preferring known signal strength, and the map draws them with per-leg
// SNR colors. State lives in the URL (?from=&to=&alt=) so routes are shareable.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { routeQueries } from '../../api/queries';
import { useTheme } from '../../hooks/useTheme';
import { mapStyleForTheme } from '../map/types';
import { useOverlays } from '../../routes/overlays';
import { formatSnr } from '../../lib/formatters';
import { snrBars } from '../../lib/signal';
import { RoutePlannerMapLazy } from './RoutePlannerMapLazy';
import { NodeCombobox, type NodePick } from './NodeCombobox';
import { NodeLabel } from './NodeLabel';
import type { PlannedRoute, PlannedRouteLeg, PlannedRouteNode } from '../../types/api';

function LegRow({ leg, index }: { leg: PlannedRouteLeg; index: number }) {
  const { t } = useTranslation();
  const bars = leg.unmeasured ? null : snrBars(leg.snr ?? null, leg.snrSampleCount);
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
      <span className="shrink-0 text-text-dim">#{index + 1}</span>
      <span className="min-w-0 flex-1 truncate" title={`${leg.from} → ${leg.to}`}>
        {leg.from.slice(0, 6).toUpperCase()} → {leg.to.slice(0, 6).toUpperCase()}
      </span>
      {leg.neighbor && (
        <span
          className="shrink-0 rounded border border-primary-dim/50 px-1 text-primary"
          title={t('routes.neighborHint')}
        >
          {t('routes.neighborLeg')}
        </span>
      )}
      {leg.unmeasured ? (
        <span
          className="shrink-0 rounded border border-border px-1 text-text-dim"
          title={t('routes.unmeasuredHint')}
        >
          {t('routes.unmeasuredLeg')}
        </span>
      ) : (
        <span className="shrink-0 tabular-nums">
          {leg.snr != null ? `${formatSnr(leg.snr)} dB` : t('routes.legNoSnr')}
          {bars !== null && <span aria-hidden="true"> {'▂▄▆█'.slice(0, bars) || '·'}</span>}
        </span>
      )}
    </div>
  );
}

function RouteCard({
  route,
  index,
  active,
  onSelect,
  onOpenNode,
}: {
  route: PlannedRoute;
  index: number;
  active: boolean;
  onSelect: () => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const via = route.nodes.slice(1, -1);
  return (
    <div
      className={`w-full rounded border px-3 py-2 text-left transition-colors ${
        active
          ? 'border-primary-dim bg-primary/5'
          : 'border-border bg-bg-base hover:border-text-dim'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-text-dim">
          {t('routes.hops', { count: route.hopCount })}
        </span>
        {route.hasUnmeasuredLegs && (
          <span
            className="rounded border border-border px-1 font-mono text-[10px] text-text-dim"
            title={t('routes.unmeasuredHint')}
          >
            {t('routes.unmeasuredLeg')}
          </span>
        )}
        {route.containsStaleNodes && (
          <span className="rounded border border-warn/40 px-1 font-mono text-[10px] text-warn">
            {t('routes.staleNode')}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          className="shrink-0 rounded border border-border px-2 py-0.5 font-mono text-[11px] text-text-muted hover:border-text-dim hover:text-text-normal"
        >
          {index === 0 ? t('routes.best') : t('routes.alternative', { n: index })}
        </button>
      </div>
      {via.length > 0 && (
        <div className="mt-1 truncate font-mono text-[11px] text-text-muted">
          {t('routes.via', {
            nodes: via
              .map((n: PlannedRouteNode) => n.name ?? n.publicKey.slice(0, 6).toUpperCase())
              .join(' → '),
          })}
        </div>
      )}
      <div className="mt-1.5 flex flex-col gap-1">
        {route.nodes.map((n: PlannedRouteNode) => (
          <span key={n.publicKey} className="flex min-w-0 items-center gap-1 text-[13px]">
            <span className="min-w-0 flex-1">
              <NodeLabel name={n.name} publicKey={n.publicKey} />
            </span>
            <button
              type="button"
              aria-label={t('routes.openNode', {
                name: n.name ?? n.publicKey.slice(0, 6).toUpperCase(),
              })}
              className="shrink-0 cursor-pointer font-mono text-[11px] text-primary hover:underline"
              onClick={() => onOpenNode(n.id)}
            >
              ↗
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex flex-col gap-0.5 border-t border-border-subtle pt-1.5">
        {route.legs.map((leg: PlannedRouteLeg, i: number) => (
          <LegRow key={`${leg.from}-${leg.to}-${i}`} leg={leg} index={i} />
        ))}
      </div>
    </div>
  );
}

export function RoutePlanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/routes' });
  const { setOverlayNodeId } = useOverlays();
  const { themeId } = useTheme();
  const styleId = useMemo(() => mapStyleForTheme(themeId), [themeId]);

  const [from, setFrom] = useState<NodePick | null>(null);
  const [to, setTo] = useState<NodePick | null>(null);

  // URL is the source of truth for shareable state; resolve pubkeys to picks once.
  // Derived during render (no effects): query data arriving flips the pick on
  // the next render, and user picks replace the whole value so no fight.
  const urlFrom = search.from?.toLowerCase() ?? null;
  const urlTo = search.to?.toLowerCase() ?? null;
  const urlAlt = search.alt ?? 0;

  const { data: fromNode } = useQuery({
    ...routeQueries.byPubkey(urlFrom && !from ? urlFrom : null),
  });
  const { data: toNode } = useQuery({
    ...routeQueries.byPubkey(urlTo && !to ? urlTo : null),
  });
  const resolvedFrom: NodePick | null =
    from ??
    (urlFrom && fromNode && fromNode.lat != null && fromNode.lng != null
      ? {
          publicKey: fromNode.publicKey.toLowerCase(),
          name: fromNode.name,
          lat: fromNode.lat,
          lng: fromNode.lng,
        }
      : null);
  const resolvedTo: NodePick | null =
    to ??
    (urlTo && toNode && toNode.lat != null && toNode.lng != null
      ? {
          publicKey: toNode.publicKey.toLowerCase(),
          name: toNode.name,
          lat: toNode.lat,
          lng: toNode.lng,
        }
      : null);
  const shownActive = urlAlt;

  const pair =
    resolvedFrom && resolvedTo && resolvedFrom.publicKey !== resolvedTo.publicKey
      ? { from: resolvedFrom.publicKey, to: resolvedTo.publicKey }
      : null;
  const { data, isLoading, isError, error } = useQuery({
    ...routeQueries.best(pair),
  });
  const paths = useMemo(() => data?.paths ?? [], [data]);
  const active = Math.min(shownActive, Math.max(0, paths.length - 1));

  const setPair = (nextFrom: NodePick | null, nextTo: NodePick | null) => {
    setFrom(nextFrom);
    setTo(nextTo);
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        from: nextFrom?.publicKey.toLowerCase(),
        to: nextTo?.publicKey.toLowerCase(),
        alt: undefined,
      }),
      replace: true,
    });
  };

  const swap = () => setPair(resolvedTo, resolvedFrom);
  const selectAlt = (i: number) => {
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, alt: i === 0 ? undefined : i }),
      replace: true,
    });
  };

  const sameNode = resolvedFrom && resolvedTo && resolvedFrom.publicKey === resolvedTo.publicKey;
  const showResults = pair !== null && !sameNode;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border-subtle bg-bg-base px-4 py-2 shrink-0 lg:flex-row lg:items-end">
        <NodeCombobox
          label={t('routes.from')}
          value={resolvedFrom}
          onPick={(p) => setPair(p, resolvedTo)}
          onClear={() => setPair(null, resolvedTo)}
          excludePublicKey={resolvedTo?.publicKey}
          autoFocus
        />
        <button
          type="button"
          aria-label={t('routes.swap')}
          title={t('routes.swap')}
          onClick={swap}
          disabled={!resolvedFrom && !resolvedTo}
          className="shrink-0 self-center rounded border border-border bg-bg-surface px-2 py-1 font-mono text-text-muted hover:border-text-dim hover:text-text-normal disabled:opacity-40 lg:mb-0.5"
        >
          ⇅
        </button>
        <NodeCombobox
          label={t('routes.to')}
          value={resolvedTo}
          onPick={(p) => setPair(resolvedFrom, p)}
          onClear={() => setPair(resolvedFrom, null)}
          excludePublicKey={resolvedFrom?.publicKey}
        />
      </div>
      <div className="px-4 pt-1.5 font-mono text-[11px] text-text-dim shrink-0">
        {t('routes.globalHint')}
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 lg:max-w-md">
          {sameNode && (
            <div role="alert" className="font-mono text-[13px] text-warn">
              {t('routes.sameNodeHint')}
            </div>
          )}
          {!showResults && !sameNode && (
            <div className="font-mono text-[13px] text-text-dim">{t('routes.pickBoth')}</div>
          )}
          {showResults && isLoading && (
            <div role="status" className="font-mono text-[13px] text-text-dim">
              {t('routes.planning')}
            </div>
          )}
          {showResults && isError && (
            <div role="alert" className="font-mono text-[13px] text-danger">
              {(error as Error)?.message || 'Error'}
            </div>
          )}
          {showResults && !isLoading && !isError && paths.length === 0 && (
            <div role="status" className="font-mono text-[13px] text-text-dim">
              {data?.reason === 'no-route' ? t('routes.noRoute') : t('routes.unknownNode')}
            </div>
          )}
          {paths.map((route: PlannedRoute, i: number) => (
            <RouteCard
              key={i}
              route={route}
              index={i}
              active={i === active}
              onSelect={() => selectAlt(i)}
              onOpenNode={setOverlayNodeId}
            />
          ))}
        </div>
        <div className="relative min-h-[320px] flex-1 lg:min-h-0">
          {paths.length > 0 ? (
            <div data-testid="route-map" className="absolute inset-0">
              <RoutePlannerMapLazy paths={paths} activeIndex={active} styleId={styleId} />
            </div>
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center px-3 text-center font-mono text-xs text-text-muted">
              {showResults ? t('routes.planning') : t('routes.pickBoth')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
