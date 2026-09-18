import { useTranslation } from 'react-i18next';
import type { PlannedRoute } from '../../types/api';
import { type NodePick } from './NodeCombobox';
import { RouteSearchForm } from './RouteSearchForm';
import { ResultsList } from './ResultsList';
import { useBottomSheet } from '../../hooks/useBottomSheet';

const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;

export function ResultsSheet({
  showResults,
  isLoading,
  isError,
  error,
  paths,
  active,
  onSelect,
  onOpenNode,
  resolvedFrom,
  resolvedTo,
  onPair,
  onSwap,
  onClearFrom,
  onClearTo,
}: {
  showResults: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  paths: PlannedRoute[];
  active: number;
  onSelect: (index: number) => void;
  onOpenNode: (nodeId: string) => void;
  resolvedFrom: NodePick | null;
  resolvedTo: NodePick | null;
  onPair: (from: NodePick | null, to: NodePick | null) => void;
  onSwap: () => void;
  onClearFrom: () => void;
  onClearTo: () => void;
}) {
  const { t } = useTranslation();
  const hasResults = paths.length > 0;
  const { snap, sheetRef, sheetHeightPx, onPointerDown, onPointerMove, onPointerUp } =
    useBottomSheet(hasResults);

  const nodeName = (node: { name?: string; publicKey: string }) =>
    node.name ?? node.publicKey.slice(0, 6).toUpperCase();
  const activeRoute = paths[active] ?? null;
  const viaSummary = activeRoute ? activeRoute.nodes.slice(1, -1).map(nodeName).join(' → ') : '';

  if (!isMobile) return null;
  return (
    <section
      aria-label={t('routes.results')}
      className="absolute inset-x-0 bottom-0 z-20 lg:hidden"
    >
      <div
        ref={sheetRef}
        style={{ height: `${sheetHeightPx}px` }}
        className="flex max-h-[85dvh] flex-col rounded-t-2xl border border-border bg-bg-base pb-[calc(3.5rem+env(safe-area-inset-bottom))] shadow-2xl transition-[height] duration-200 ease-out motion-reduce:transition-none"
      >
        <button
          type="button"
          aria-expanded={snap !== 'peek'}
          aria-controls="route-results-list"
          aria-label={t('routes.toggleResults')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex min-h-11 w-full touch-none select-none cursor-grab flex-col items-center justify-center gap-1 pt-2 outline-none focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span aria-hidden className="h-1 w-9 rounded-full bg-border" />
          {snap === 'peek' && activeRoute && (
            <span className="px-4 font-mono text-[11px] text-text-muted">
              {t('routes.best')} · {activeRoute.hopCount}{' '}
              {t('routes.hops', { count: activeRoute.hopCount })}
              {viaSummary ? ` · via ${viaSummary}` : ''} · {t('routes.tapToExpand')}
            </span>
          )}
          {snap === 'peek' && !activeRoute && (
            <span className="px-4 font-mono text-[11px] text-text-muted">
              {t('routes.tapToExpand')}
            </span>
          )}
          {snap !== 'peek' && (
            <span className="px-4 font-mono text-[10px] text-text-dim">
              {snap === 'half' ? t('routes.pinchToExpand') : t('routes.swipeDownToCollapse')}
            </span>
          )}
        </button>
        <div className="border-b border-border rounded-lg bg-bg-surface/50 px-3 pt-2">
          <RouteSearchForm
            resolvedFrom={resolvedFrom}
            resolvedTo={resolvedTo}
            onPair={onPair}
            onSwap={onSwap}
            onClearFrom={onClearFrom}
            onClearTo={onClearTo}
            autoFocus={false}
          />
        </div>
        <div
          id="route-results-list"
          data-testid="route-results-list"
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y px-3 pb-3"
        >
          {showResults && !isLoading && !isError && paths.length === 0 && (
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg">
              {t('routes.noRoute')}
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
          {!showResults && (
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2 font-mono text-[13px] text-text-dim shadow-lg">
              {t('routes.pickBoth')}
            </div>
          )}
          {hasResults && (
            <ResultsList
              paths={paths}
              active={active}
              onSelect={onSelect}
              onOpenNode={onOpenNode}
            />
          )}
        </div>
      </div>
    </section>
  );
}
