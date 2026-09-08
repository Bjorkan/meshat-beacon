import { useTranslation } from 'react-i18next';
import { lazy, Suspense } from 'react';
import type { Node } from './types';

const NodeLocationMap = lazy(() =>
  import('./NodeLocationMap').then((m) => ({ default: m.NodeLocationMap })),
);

// Lazy single-node mini map for the Location section: only loaded when coordinates exist, so the
// Nodes route never pays the MapLibre cost for unlocated nodes.
export function NodeLocationMapLazy({ node }: { node: Node }) {
  const { t } = useTranslation();
  if (node.lat == null || node.lng == null) return null;
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="flex h-36 flex-col items-center justify-center gap-2 rounded-md border border-border bg-bg-base font-mono text-xs text-text-muted"
        >
          <span>{t('map.loadingLocation')}</span>
          <span>
            {node.lat.toFixed(5)}, {node.lng.toFixed(5)}
          </span>
        </div>
      }
    >
      <NodeLocationMap node={node} />
    </Suspense>
  );
}
