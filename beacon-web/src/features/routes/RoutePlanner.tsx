// RoutePlanner: Google-Maps-like best-route planner replacing the old
// observed-routes table. Pick from-node + to-node (name search with
// suggestions), the server computes best-first paths over the global neighbor
// graph preferring known signal strength, and the map draws them with per-leg
// SNR colors. State lives in the URL (?from=&to=&alt=) so routes are shareable.
// Mobile (<1024px): map always visible behind a floating search bar and a
// draggable bottom sheet with snap points. Desktop (>=1024px): floating
// left panel as before.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { routeQueries } from '../../api/queries';
import { useTheme } from '../../hooks/useTheme';
import { mapStyleForTheme } from '../map/types';
import { useOverlays } from '../../routes/overlays';
import { RoutePlannerMapLazy } from './RoutePlannerMapLazy';
import { type NodePick } from './NodeCombobox';
import { RouteSearchForm } from './RouteSearchForm';
import { ResultsList } from './ResultsList';
import { ResultsSheet } from './ResultsSheet';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { useBottomSheet } from '../../hooks/useBottomSheet';

function RoutePlanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/routes' });
  const { setOverlayNodeId } = useOverlays();
  const { themeId } = useTheme();
  const styleId = useMemo(() => mapStyleForTheme(themeId), [themeId]);

  const [from, setFrom] = useState<NodePick | null>(null);
  const [to, setTo] = useState<NodePick | null>(null);

  const urlFrom = search.from?.toLowerCase() ?? null;
  const urlTo = search.to?.toLowerCase() ?? null;
  const urlAlt = search.alt ?? 0;

  const { data: fromNode } = useQuery({
    ...routeQueries.byPubkey(urlFrom && !from ? urlFrom : null),
  });
  const { data: toNode } = useQuery({
    ...routeQueries.byPubkey(urlTo && !to ? urlTo : null),
  });
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

  const hasResults = paths.length > 0;
  const { sheetHeightPx } = useBottomSheet(hasResults);

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
      <div className="absolute inset-0 z-0" data-testid="route-map">
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
            bottomPadding={sheetHeightPx}
          />
        </ErrorBoundary>
      </div>

      <div className="absolute inset-x-0 top-0 z-20 p-2 pointer-events-none lg:hidden">
        <div className="pointer-events-auto mr-12 rounded-xl border border-border bg-bg-base/95 p-3 shadow-lg backdrop-blur">
          <RouteSearchForm
            resolvedFrom={resolvedFrom}
            resolvedTo={resolvedTo}
            onPair={setPair}
            onSwap={swap}
            onClearFrom={() => setPair(null, resolvedTo)}
            onClearTo={() => setPair(resolvedFrom, null)}
            autoFocus={false}
          />
        </div>
      </div>

      <div className="absolute inset-y-0 left-0 z-10 hidden w-full max-w-md flex-col gap-2 overflow-y-auto overscroll-y-contain p-3 lg:p-4 lg:flex">
        <RouteSearchForm
          resolvedFrom={resolvedFrom}
          resolvedTo={resolvedTo}
          onPair={setPair}
          onSwap={swap}
          onClearFrom={() => setPair(null, resolvedTo)}
          onClearTo={() => setPair(resolvedFrom, null)}
          autoFocus
        />
        <div data-testid="route-panel" className="min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y">
          {sameNode && (
            <div role="alert" className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-warn shadow-lg">
              {t('routes.sameNodeHint')}
            </div>
          )}
          {urlEndpointInvalid && !sameNode && (
            <div role="alert" className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-warn shadow-lg">
              {t('routes.nonRepeaterEndpoint')}
            </div>
          )}
          {!showResults && !sameNode && !urlEndpointInvalid && (
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg">
              {t('routes.pickBoth')}
            </div>
          )}
          {showResults && isLoading && (
            <div role="status" className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg">
              {t('routes.planning')}
            </div>
          )}
          {showResults && isError && (
            <div role="alert" className="rounded-lg border border-danger/40 bg-bg-base px-3 py-2 font-mono text-[13px] text-danger shadow-lg">
              {(error as Error)?.message || 'Error'}
            </div>
          )}
          {showResults && !isLoading && !isError && paths.length === 0 && (
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg">
              {data?.reason === 'no-route' ? t('routes.noRoute') : t('routes.unknownNode')}
            </div>
          )}
          <ResultsList paths={paths} active={active} onSelect={selectAlt} onOpenNode={setOverlayNodeId} />
        </div>
      </div>

      <ResultsSheet
        showResults={showResults}
        isLoading={isLoading}
        isError={isError}
        error={error}
        paths={paths}
        active={active}
        onSelect={selectAlt}
        onOpenNode={setOverlayNodeId}
      />
    </div>
  );
}

export { RoutePlanner };
