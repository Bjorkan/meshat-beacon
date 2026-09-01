// Spiderfy 2.0.0 normally fills this metadata in applyTo(). Beacon deliberately does not call
// applyTo(), because it owns the cluster-click → expansion-zoom → terminal-spiderfy policy.
// Direct spiderfy() still dereferences the field while creating leaf layers, so keep that one
// version-pinned compatibility detail isolated here.
interface DirectSpiderfyCompatibilityTarget {
  clickedParentClusterStyle: {
    type: "symbol";
    layout: object;
    paint: object;
  } | null;
}

export function prepareSpiderfyForDirectUse(spider: DirectSpiderfyCompatibilityTarget): void {
  spider.clickedParentClusterStyle = { type: "symbol", layout: {}, paint: {} };
}
