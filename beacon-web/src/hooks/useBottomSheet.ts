import { useCallback, useRef, useState } from 'react';

type Snap = 'peek' | 'half' | 'full';

const SNAP_PEEK = 112;
const SNAP_HALF_RATIO = 0.45;
const SNAP_FULL_RATIO = 0.85;
const DRAG_THRESHOLD = 60;
const DRAG_VELOCITY = 0.5;

function dvhToPx(ratio: number): number {
  if (typeof window === 'undefined') return ratio * 844;
  return Math.round(window.innerHeight * ratio);
}

function snapHeightPx(snap: Snap): number {
  switch (snap) {
    case 'peek':
      return SNAP_PEEK;
    case 'half':
      return dvhToPx(SNAP_HALF_RATIO);
    case 'full':
      return dvhToPx(SNAP_FULL_RATIO);
  }
}

export function useBottomSheet(hasResults: boolean) {
  const snap: Snap = hasResults ? 'half' : 'peek';
  const targetPx = snapHeightPx(snap);
  const [sheetHeightPx, setSheetHeightPx] = useState(targetPx);
  const [dragPx, setDragPx] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const dragActiveRef = useRef(false);

  const displayHeight = dragPx ?? sheetHeightPx;

  const transitionTo = useCallback((next: Snap) => {
    setDragPx(null);
    setSheetHeightPx(snapHeightPx(next));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    dragActiveRef.current = false;
    startYRef.current = e.clientY;
    startHeightRef.current = sheetRef.current?.getBoundingClientRect().height ?? SNAP_PEEK;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const deltaY = startYRef.current - e.clientY;
    const newHeight = Math.min(
      Math.max(startHeightRef.current + deltaY, SNAP_PEEK),
      dvhToPx(SNAP_FULL_RATIO),
    );
    if (Math.abs(deltaY) > 8) dragActiveRef.current = true;
    setDragPx(newHeight);
    const sheet = sheetRef.current;
    if (sheet) {
      sheet.style.transition = 'none';
      sheet.style.height = `${newHeight}px`;
    }
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const deltaY = startYRef.current - e.clientY;
      const velocity = Math.abs(deltaY) / 16;
      const sheet = sheetRef.current;
      if (sheet) {
        sheet.style.transition = '';
        sheet.style.height = '';
      }
      setDragPx(null);
      if (!dragActiveRef.current) {
        if (sheet && snap !== 'peek') {
          const current = sheet.getBoundingClientRect().height;
          if (current > SNAP_PEEK + 20) {
            setSheetHeightPx(SNAP_PEEK);
          }
        }
        return;
      }
      if (deltaY > DRAG_THRESHOLD || (deltaY > 0 && velocity > DRAG_VELOCITY)) {
        setSheetHeightPx(snap === 'full' ? snapHeightPx('half') : snapHeightPx('peek'));
      } else if (deltaY < -DRAG_THRESHOLD || (deltaY < 0 && velocity > DRAG_VELOCITY)) {
        setSheetHeightPx(snap === 'peek' ? snapHeightPx('half') : snapHeightPx('full'));
      } else {
        setSheetHeightPx(targetPx);
      }
    },
    [snap, targetPx],
  );

  const togglePeek = useCallback(() => {
    if (snap === 'peek') {
      setSheetHeightPx(snapHeightPx('half'));
    } else {
      setSheetHeightPx(SNAP_PEEK);
    }
  }, [snap]);

  return {
    snap,
    sheetRef,
    sheetHeightPx: displayHeight,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    togglePeek,
    transitionTo,
  };
}
