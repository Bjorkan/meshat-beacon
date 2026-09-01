// Drop the shared node/observer selection when the user changes region, so a detail panel doesn't
// keep showing an entity that's no longer in the re-queried map/table. Watches the raw selection
// rather than the resolved regionKey: the async slug→IATA expansion on load bumps regionKey without
// any user action, and that must NOT count as a change or it would wipe a deep-linked selection
// before it renders. Comparing the previous selection (vs a first-run flag) also survives
// StrictMode's double effect invoke.
import { useEffect, useRef } from "react";
import { useRegionSelection } from "../hooks/useRegion";

export function SelectionResetOnRegion({ onRegionChange }: { onRegionChange: () => void }) {
  const { selection } = useRegionSelection();
  const prev = useRef(selection);

  useEffect(() => {
    if (prev.current === selection) return; // initial mount, or a re-render that didn't change the selection
    prev.current = selection;
    onRegionChange();
  }, [selection, onRegionChange]);

  return null;
}
