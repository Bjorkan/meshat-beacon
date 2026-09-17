// RoutePlanner: Google-Maps-like best-route planner replacing the old
// observed-routes table. Pick from-node + to-node (name search with
// suggestions), the server computes best-first paths over the global neighbor
// graph preferring known signal strength, and the map draws them with per-leg
// SNR colors. State lives in the URL (?from=&to=&alt=) so routes are shareable.
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { routeQueries } from '../../api/queries';
import { useTheme } from '../../hooks/useTheme';
import { mapStyleForTheme } from '../map/types';
import { useOverlays } from '../../routes/overlays';
import { formatSnr } from '../../lib/formatters';
import { Timestamp } from '../../components/Timestamp';
import { RoutePlannerMapLazy } from './RoutePlannerMapLazy';
import { NodeCombobox, type NodePick } from './NodeCombobox';
import { CopyButton } from '../../components/CopyButton';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { exportMeshcoreRoute } from './route-features';
import type { PlannedRoute, PlannedRouteLeg, PlannedRouteNode } from '../../types/api';

function LegRow({ leg }: { leg: PlannedRouteLeg }) {
  const { t } = useTranslation();
  return (
    <div className="ml-2 space-y-1 border-l border-border py-2 pl-4 text-xs text-text-muted">
      <p className="tabular-nums">
        {leg.unmeasured
          ? t('routes.unmeasuredLeg')
          : leg.snr != null
            ? `${formatSnr(leg.snr)} dB`
            : t('routes.legNoSnr')}
      </p>
      {leg.unmeasured && leg.snr != null && (
        <p>{t('routes.lastKnownSnr', { snr: formatSnr(leg.snr) })}</p>
      )}
      {leg.snrSampleCount > 0 && leg.snrLastSeen > 0 && (
        <p>
          {t('routes.snrSamples', { count: leg.snrSampleCount })}
          {' · '}
          <Timestamp value={leg.snrLastSeen} static />
        </p>
      )}
      {leg.unseen && <p className="text-warn">{t('routes.unseenLeg')}</p>}
      {leg.neighbor && <p>{t('routes.neighborDirection')}</p>}
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
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const titleId = useId();
  const via = route.nodes.slice(1, -1);
  const measuredCount = route.legs.filter((leg) => !leg.unmeasured && leg.snr != null).length;
  const unseenCount = route.legs.filter((leg) => leg.unseen).length;
  const staleCount = route.nodes.filter((node) => node.stale).length;
  const nodeName = (node: PlannedRouteNode) =>
    node.name ?? node.publicKey.slice(0, 6).toUpperCase();
  const viaNames = via.map(nodeName);
  const viaSummary =
    via.length > 3
      ? [
          viaNames[0],
          t('routes.moreNodes', { count: via.length - 2 }),
          viaNames[via.length - 1],
        ].join(' → ')
      : viaNames.join(' → ');
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
  const label = index === 0 ? t('routes.best') : t('routes.alternative', { n: index });
  return (
    <article
      aria-labelledby={titleId}
      onClick={(e) => {
        if (!(e.target instanceof Element) || e.target.closest('button, a, [data-route-details]'))
          return;
        if (!active) onSelect();
      }}
      className={`w-full cursor-pointer rounded-lg border p-3 text-left shadow-lg transition-colors ${
        active ? 'border-primary-dim bg-bg-base' : 'border-border bg-bg-base hover:border-text-dim'
      }`}
    >
      <button
        type="button"
        aria-label={t('routes.selectRoute', { label })}
        aria-pressed={active}
        onClick={onSelect}
        className="flex min-h-9 w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span id={titleId} className="font-mono text-[13px] font-semibold text-text-bright">
          {label}
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {t('routes.hops', { count: route.hopCount })}
        </span>
        {active && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-primary">
            {t('routes.selected')}
          </span>
        )}
      </button>
      {!expanded && (
        <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-text-muted">
          {via.length > 0 ? t('routes.via', { nodes: viaSummary }) : t('routes.directRoute')}
        </p>
      )}
      <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-text-muted">
        <p>{t('routes.snrCoverage', { measured: measuredCount, total: route.legs.length })}</p>
        {unseenCount > 0 && (
          <p className="text-warn">{t('routes.unseenHops', { count: unseenCount })}</p>
        )}
        {staleCount > 0 && (
          <p className="text-warn">{t('routes.staleNodes', { count: staleCount })}</p>
        )}
      </div>
      <div id={detailsId} hidden={!expanded} data-route-details className="cursor-auto">
        {expanded && (
          <>
            <ol className="mt-3 border-t border-border-subtle pt-2">
              {route.nodes.map((node, i) => (
                <li key={`${node.publicKey}-${i}`}>
                  <button
                    type="button"
                    aria-label={t('routes.openNode', { name: nodeName(node) })}
                    className="min-h-9 w-full rounded py-1 text-left text-[13px] hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => onOpenNode(node.id)}
                  >
                    <span className="break-words font-semibold">{nodeName(node)}</span>
                    {node.name && (
                      <span className="ml-2 inline-block font-mono text-[11px] text-text-muted">
                        {node.publicKey.slice(0, 6).toUpperCase()}
                      </span>
                    )}
                  </button>
                  {node.stale && <p className="pb-1 text-xs text-warn">{t('routes.staleNode')}</p>}
                  {route.legs[i] && <LegRow leg={route.legs[i]} />}
                </li>
              ))}
            </ol>
            {meshcoreRoute != null && (
              <div className="mt-2 border-t border-border-subtle pt-2 text-xs text-text-muted">
                <p>{t('routes.meshcoreFormat')}</p>
                <code className="mt-1 block select-text break-all">{meshcoreRoute}</code>
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((shown) => !shown)}
          className="min-h-9 rounded text-xs text-text-muted underline underline-offset-4 hover:text-text-normal focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t(expanded ? 'routes.hideDetails' : 'routes.showDetails')}
        </button>
        {meshcoreRoute != null && (
          <CopyButton
            value={meshcoreRoute}
            label={t('routes.copyMeshcoreRoute')}
            copiedLabel={t('routes.meshcoreRouteCopied')}
            ariaLabel={t('routes.copyMeshcoreRoute')}
            className="min-h-9 max-w-full focus-visible:outline-2 focus-visible:outline-primary"
          />
        )}
      </div>
      {meshcoreTooLong && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-warn">
          {t('routes.meshcoreTooLong')}
        </p>
      )}
      {meshcoreRoute != null && multibyteUnconfirmed && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-warn">
          {t('routes.multibyteUnconfirmed')}
        </p>
      )}
    </article>
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
    <div className="relative flex min-h-0 flex-1 flex-col overflow-clip">
      {/* Floating Google-Maps-style search panel: from/to inputs + results
          overlay the map on the left; the map is always mounted behind. */}
      <div className="absolute inset-y-0 left-0 z-10 flex w-full max-w-md flex-col gap-2 overflow-y-auto overscroll-y-contain p-3 lg:p-4">
        <div className="shrink-0 rounded-lg border border-border bg-bg-base p-3 shadow-lg">
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
        <div className="flex shrink-0 flex-col gap-2">
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
          {paths.length > 0 && (
            <p className="rounded border border-border bg-bg-base px-3 py-2 text-xs leading-relaxed text-text-muted">
              {t('routes.rankingHint')}
            </p>
          )}
          {paths.map((route: PlannedRoute, i: number) => (
            <RouteCard
              key={route.nodes.map((node) => node.publicKey).join('-')}
              route={route}
              index={i}
              active={i === active}
              onSelect={() => selectAlt(i)}
              onOpenNode={setOverlayNodeId}
            />
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
          <RoutePlannerMapLazy
            paths={paths}
            activeIndex={active}
            styleId={styleId}
            onSelectRoute={selectAlt}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
