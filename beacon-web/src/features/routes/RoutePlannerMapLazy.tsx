import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlannedRoute } from '../../types/api';
import type { RouteEndpoint } from './route-features';

const RoutePlannerMap = lazy(() =>
  import('./RoutePlannerMap').then((m) => ({ default: m.RoutePlannerMapInner })),
);

// Lazy planner map: MapLibre stays out of the startup bundle and loads only
// when the planner opens, including before either endpoint is selected.
export function RoutePlannerMapLazy(props: {
  paths: PlannedRoute[];
  endpoints: (RouteEndpoint | null)[];
  activeIndex: number;
  styleId: string;
  onSelectRoute: (index: number) => void;
  bottomPadding?: number;
}) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 font-mono text-xs text-text-muted"
        >
          <span>{t('map.loadingLocation')}</span>
        </div>
      }
    >
      <RoutePlannerMap {...props} />
    </Suspense>
  );
}
