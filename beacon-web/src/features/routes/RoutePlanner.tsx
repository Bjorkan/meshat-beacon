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
import { CopyButton } from '../../components/CopyButton';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { exportMeshcoreRoute } from './route-features';
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
  // MeshCore export for this card's route (best or alternative): canonical
  // ordered repeater list from the legs. `too-long` (over the 21-hash
  // MeshCore limit) renders an explanation; other failures hide the row so
  // no broken/partial route can ever be copied.
  const meshcoreExport = exportMeshcoreRoute(route);
  const meshcoreRoute = meshcoreExport.ok ? meshcoreExport.value : null;
  const meshcoreTooLong = !meshcoreExport.ok && meshcoreExport.reason === 'too-long';
  // 3-byte forwarding is confirmed per node from the planner response.
  // Unconfirmed (unknown, never "known incompatible") warns without
  // blocking the copy.
  const multibyteUnconfirmed = route.nodes.some((n) => n.supportsMultibytePaths !== true);
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
      {meshcoreTooLong ? (
        <div
          role="status"
          className="mt-1.5 border-t border-border-subtle pt-1.5 font-mono text-[11px] text-warn"
        >
          {t('routes.meshcoreTooLong')}
        </div>
      ) : (
        meshcoreRoute != null && (
          <div className="mt-1.5 flex items-center gap-2 border-t border-border-subtle pt-1.5">
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-dim"
              title={meshcoreRoute}
            >
              {meshcoreRoute}
            </span>
            <CopyButton
              value={meshcoreRoute}
              label={t('routes.copyMeshcoreRoute')}
              copiedLabel={t('routes.meshcoreRouteCopied')}
              ariaLabel={t('routes.copyMeshcoreRoute')}
              className="shrink-0"
            />
          </div>
        )
      )}
      {meshcoreRoute != null && multibyteUnconfirmed && (
        <div
          role="status"
          className="mt-1.5 font-mono text-[11px] text-warn"
          title={t('routes.multibyteUnconfirmed')}
        >
          {t('routes.multibyteUnconfirmed')}
        </div>
      )}
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
  // Repeater-only: a URL pubkey resolving to a non-repeater (or an unlocated
  // node) never becomes an endpoint — the planner shows a validation state.
  const urlFrom = search.from?.toLowerCase() ?? null;
  const urlTo = search.to?.toLowerCase() ?? null;
  const urlAlt = search.alt ?? 0;

  const { data: fromNode } = useQuery({
    ...routeQueries.byPubkey(urlFrom && !from ? urlFrom : null),
  });
  const { data: toNode } = useQuery({
    ...routeQueries.byPubkey(urlTo && !to ? urlTo : null),
  });
  // tri-state: undefined = still resolving (query in flight), null = resolved
  // non-repeater/invalid (validation state), NodePick = usable repeater.
  const urlFromPick: NodePick | null | undefined =
    urlFrom == null || from
      ? undefined
      : fromNode === undefined
        ? undefined
        : fromNode != null &&
            fromNode.nodeType === 2 &&
            fromNode.lat != null &&
            fromNode.lng != null
          ? {
              publicKey: fromNode.publicKey.toLowerCase(),
              name: fromNode.name,
              lat: fromNode.lat,
              lng: fromNode.lng,
              nodeType: fromNode.nodeType,
            }
          : null;
  const urlToPick: NodePick | null | undefined =
    urlTo == null || to
      ? undefined
      : toNode === undefined
        ? undefined
        : toNode != null && toNode.nodeType === 2 && toNode.lat != null && toNode.lng != null
          ? {
              publicKey: toNode.publicKey.toLowerCase(),
              name: toNode.name,
              lat: toNode.lat,
              lng: toNode.lng,
              nodeType: toNode.nodeType,
            }
          : null;
  // A URL endpoint that finished resolving to a non-repeater (or an
  // unlocated/unknown node): hard validation state, never a silent endpoint.
  const urlFromInvalid = urlFrom != null && !from && fromNode !== undefined && urlFromPick == null;
  const urlToInvalid = urlTo != null && !to && toNode !== undefined && urlToPick == null;
  const urlEndpointInvalid = urlFromInvalid || urlToInvalid;
  const resolvedFrom: NodePick | null = from ?? urlFromPick ?? null;
  const resolvedTo: NodePick | null = to ?? urlToPick ?? null;
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
  const showResults = pair !== null && !sameNode && !urlEndpointInvalid;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Floating Google-Maps-style search panel: from/to inputs + results
          overlay the map on the left; the map is always mounted behind. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-full max-w-md flex-col gap-2 overflow-y-auto p-3 lg:p-4">
        <div className="pointer-events-auto rounded-lg border border-border bg-bg-base p-3 shadow-lg">
          <div className="flex flex-col gap-2">
            <NodeCombobox
              label={t('routes.from')}
              value={resolvedFrom}
              onPick={(p) => setPair(p, resolvedTo)}
              onClear={() => setPair(null, resolvedTo)}
              excludePublicKey={resolvedTo?.publicKey}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <div className="px-1 font-mono text-[11px] text-text-dim">
                {t('routes.globalHint')}
              </div>
              <span className="flex-1" />
              <button
                type="button"
                aria-label={t('routes.swap')}
                title={t('routes.swap')}
                onClick={swap}
                disabled={!resolvedFrom && !resolvedTo}
                className="shrink-0 rounded border border-border bg-bg-surface px-2 py-1 font-mono text-text-muted hover:border-text-dim hover:text-text-normal disabled:opacity-40"
              >
                ⇅
              </button>
            </div>
            <NodeCombobox
              label={t('routes.to')}
              value={resolvedTo}
              onPick={(p) => setPair(resolvedFrom, p)}
              onClear={() => setPair(resolvedFrom, null)}
              excludePublicKey={resolvedFrom?.publicKey}
            />
          </div>
        </div>
        <div className="pointer-events-auto flex min-h-0 flex-col gap-2">
          {sameNode && (
            <div
              role="alert"
              className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-warn shadow-lg"
            >
              {t('routes.sameNodeHint')}
            </div>
          )}
          {urlEndpointInvalid && !sameNode && (
            <div
              role="alert"
              className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-warn shadow-lg"
            >
              {t('routes.nonRepeaterEndpoint')}
            </div>
          )}
          {!showResults && !sameNode && !urlEndpointInvalid && (
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg">
              {t('routes.pickBoth')}
            </div>
          )}
          {showResults && isLoading && (
            <div
              role="status"
              className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg"
            >
              {t('routes.planning')}
            </div>
          )}
          {showResults && isError && (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-bg-base px-3 py-2 font-mono text-[13px] text-danger shadow-lg"
            >
              {(error as Error)?.message || 'Error'}
            </div>
          )}
          {showResults && !isLoading && !isError && paths.length === 0 && (
            <div
              role="status"
              className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg"
            >
              {data?.reason === 'no-route' ? t('routes.noRoute') : t('routes.unknownNode')}
            </div>
          )}
          {paths.map((route: PlannedRoute, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-bg-base shadow-lg">
              <RouteCard
                route={route}
                index={i}
                active={i === active}
                onSelect={() => selectAlt(i)}
                onOpenNode={setOverlayNodeId}
              />
            </div>
          ))}
        </div>
      </div>
      {/* Map is always mounted (Google-Maps-style background layer), also
          before any route is picked — previously it only mounted with results. */}
      <div className="absolute inset-0" data-testid="route-map">
        {/* Local boundary: a MapLibre/chunk/WebGL failure must never
            unmount the route cards above — map errors stay in this pane. */}
        <ErrorBoundary
          fallback={
            <div
              role="status"
              className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-3 text-center font-mono text-xs text-text-muted"
            >
              <span>{t('routes.mapFailed')}</span>
            </div>
          }
        >
          <RoutePlannerMapLazy paths={paths} activeIndex={active} styleId={styleId} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
