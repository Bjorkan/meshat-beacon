import { useTranslation } from 'react-i18next';
import { lazy, Suspense } from 'react';
import type { TracePath } from './trace-path';

const TracePathMap = lazy(() =>
  import('./TracePathMap').then((m) => ({ default: m.TracePathMapInner })),
);

// Lazy trace mini-map: MapLibre chunkas bort från startpaketet (samma mönster som
// PacketPathMapModal och Nod-detaljens platskarta) och laddas bara när minst ett
// paket ritade verifierbara ben.
export function TracePathMapLazy(props: {
  paths: TracePath[];
  selectedKey: string | null;
  styleId: string;
}) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="flex h-[320px] flex-col items-center justify-center gap-2 font-mono text-xs text-text-muted lg:h-[380px]"
        >
          <span>{t('map.loadingLocation')}</span>
        </div>
      }
    >
      <TracePathMap {...props} />
    </Suspense>
  );
}
