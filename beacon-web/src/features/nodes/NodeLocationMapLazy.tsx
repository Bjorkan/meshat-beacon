import { lazy, Suspense } from 'react';
import type { Node } from './types';

const NodeLocationMap = lazy(() =>
  import('./NodeLocationMap').then((m) => ({ default: m.NodeLocationMap })),
);

// Lazy single-node mini map for the Location section: only loaded when coordinates exist, so the
// Nodes route never pays the MapLibre cost for unlocated nodes.
export function NodeLocationMapLazy({ node }: { node: Node }) {
  if (node.lat == null || node.lng == null) return null;
  return (
    <Suspense fallback={<div className="h-36 rounded-md border border-border bg-bg-base" />}>
      <NodeLocationMap node={node} />
    </Suspense>
  );
}
