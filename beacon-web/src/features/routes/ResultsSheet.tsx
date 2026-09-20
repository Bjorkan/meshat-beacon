import { useTranslation } from 'react-i18next';
import type { PlannedRoute } from '../../types/api';
import { ResultsList } from './ResultsList';
import type { useBottomSheet } from '../../hooks/useBottomSheet';

export function ResultsSheet({
  sheet,
  sheetRef,
  isMobile,
  showResults,
  isLoading,
  isError,
  error,
  notice,
  emptyMessage,
  paths,
  active,
  onSelect,
  onOpenNode,
}: {
  sheet: Omit<ReturnType<typeof useBottomSheet>, 'sheetRef' | 'containerRef'>;
  sheetRef: ReturnType<typeof useBottomSheet>['sheetRef'];
  isMobile: boolean;
  showResults: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  notice?: string;
  emptyMessage: string;
  paths: PlannedRoute[];
  active: number;
  onSelect: (index: number) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const activeRoute = paths[active];
  const summary = activeRoute
    ? `${t('routes.hops', { count: activeRoute.hopCount })} · ${active === 0 ? t('routes.best') : t('routes.alternative', { n: active })}`
    : t('routes.pickBoth');

  return (
    <section
      ref={sheetRef}
      aria-label={t('routes.results')}
      data-testid="route-sheet"
      data-snap={sheet.snap}
      style={
        isMobile
          ? { height: sheet.sheetHeightPx, transition: sheet.isDragging ? 'none' : undefined }
          : undefined
      }
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex min-h-0 flex-col overflow-hidden rounded-t-3xl border-t border-border bg-bg-base shadow-[0_-4px_24px_#0002] transition-[height] duration-200 ease-out motion-reduce:transition-none lg:relative lg:inset-auto lg:flex-1 lg:rounded-none lg:border-0 lg:shadow-none"
    >
      <button
        type="button"
        aria-expanded={sheet.snap !== 'peek'}
        aria-controls="route-results-list"
        aria-label={t('routes.toggleResults')}
        onPointerDown={sheet.onPointerDown}
        onPointerMove={sheet.onPointerMove}
        onPointerUp={sheet.onPointerUp}
        onPointerCancel={sheet.onPointerCancel}
        onLostPointerCapture={sheet.onPointerCancel}
        onKeyDown={sheet.onKeyDown}
        onClick={sheet.togglePeek}
        className="flex min-h-11 w-full shrink-0 touch-none select-none cursor-grab items-center justify-center active:cursor-grabbing lg:hidden"
      >
        <span aria-hidden className="h-1 w-10 rounded-full bg-text-muted/40" />
      </button>
      <div className="shrink-0 border-b border-border-subtle px-5 pb-3 lg:pt-5">
        <h2 className="text-lg font-semibold text-text-bright">{t('routes.results')}</h2>
        <p className="truncate text-sm text-text-muted">{summary}</p>
      </div>
      <div
        id="route-results-list"
        data-testid={isMobile ? 'route-results-list' : 'route-panel'}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y pb-[env(safe-area-inset-bottom)]"
      >
        {notice ? (
          <p role="alert" className="px-5 py-4 text-sm text-warn">
            {notice}
          </p>
        ) : (
          <>
            {!showResults && (
              <p className="px-5 py-4 text-sm text-text-muted">{t('routes.globalHint')}</p>
            )}
            {showResults && isLoading && (
              <p role="status" className="px-5 py-4 text-sm text-text-muted">
                {t('routes.planning')}
              </p>
            )}
            {showResults && isError && (
              <p role="alert" className="px-5 py-4 text-sm text-danger">
                {(error as Error)?.message || 'Error'}
              </p>
            )}
            {showResults && !isLoading && !isError && paths.length === 0 && (
              <p className="px-5 py-4 text-sm text-text-muted">{emptyMessage}</p>
            )}
            <ResultsList
              paths={paths}
              active={active}
              onSelect={onSelect}
              onOpenNode={onOpenNode}
            />
          </>
        )}
      </div>
    </section>
  );
}
