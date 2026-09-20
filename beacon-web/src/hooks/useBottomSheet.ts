import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

type Snap = 'peek' | 'half' | 'full';
const SNAPS: Snap[] = ['peek', 'half', 'full'];
const PEEK_HEIGHT = 112;

export function useBottomSheet(hasResults: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(700);
  const [snap, setSnap] = useState<Snap>(hasResults ? 'half' : 'peek');
  const [hadResults, setHadResults] = useState(hasResults);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const gesture = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  // Open for newly available results, but preserve the user's position on
  // selection changes and background refreshes.
  if (hadResults !== hasResults) {
    setHadResults(hasResults);
    setSnap(hasResults ? 'half' : 'peek');
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Measure the actual available page area, excluding the app's navigation.
  // Leave room for the floating search fields even at the highest snap.
  const full = Math.max(PEEK_HEIGHT, containerHeight - 160);
  const heights = {
    peek: Math.min(PEEK_HEIGHT, full),
    half: Math.max(PEEK_HEIGHT, Math.min(Math.round(containerHeight * 0.5), full)),
    full,
  };
  const clamp = (height: number) => Math.max(heights.peek, Math.min(full, height));
  const settledHeightPx = heights[snap];

  const transitionTo = useCallback((next: Snap) => {
    setSnap(next);
    setDragHeight(null);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    gesture.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheetRef.current?.getBoundingClientRect().height || settledHeightPx,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const elapsed = event.timeStamp - drag.lastTime;
    if (elapsed > 0) drag.velocity = (drag.lastY - event.clientY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    if (Math.abs(drag.startY - event.clientY) > 6) drag.moved = true;
    if (drag.moved) setDragHeight(clamp(drag.startHeight + drag.startY - event.clientY));
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    gesture.current = null;
    suppressClick.current = drag.moved;
    if (drag.moved) {
      const height = clamp(drag.startHeight + drag.startY - event.clientY);
      const velocity = event.timeStamp - drag.lastTime < 120 ? drag.velocity : 0;
      // Slow drags settle at the nearest stop; a short flick advances in its
      // direction using real elapsed time rather than a fixed frame duration.
      let next = SNAPS.reduce((nearest, candidate) =>
        Math.abs(heights[candidate] - height) < Math.abs(heights[nearest] - height)
          ? candidate
          : nearest,
      );
      if (Math.abs(velocity) > 0.5) {
        next =
          velocity > 0
            ? (SNAPS.find((candidate) => heights[candidate] > height + 1) ?? 'full')
            : ([...SNAPS].reverse().find((candidate) => heights[candidate] < height - 1) ?? 'peek');
      }
      setSnap(next);
    }
    setDragHeight(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    suppressClick.current = true;
    setDragHeight(null);
  };

  const togglePeek = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    transitionTo(snap === 'peek' ? 'half' : 'peek');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    suppressClick.current = false;
    const index = SNAPS.indexOf(snap);
    const next =
      event.key === 'ArrowUp'
        ? SNAPS[Math.min(index + 1, 2)]
        : event.key === 'ArrowDown'
          ? SNAPS[Math.max(index - 1, 0)]
          : event.key === 'Home'
            ? 'peek'
            : event.key === 'End'
              ? 'full'
              : null;
    if (next) {
      event.preventDefault();
      transitionTo(next);
    }
  };

  return {
    snap,
    containerRef,
    sheetRef,
    settledHeightPx,
    sheetHeightPx: dragHeight == null ? settledHeightPx : clamp(dragHeight),
    isDragging: dragHeight != null,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
    togglePeek,
    transitionTo,
  };
}
