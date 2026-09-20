import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useBottomSheet } from '../../src/hooks/useBottomSheet';

function setup(hasResults = true) {
  const hook = renderHook(({ results }) => useBottomSheet(results), {
    initialProps: { results: hasResults },
  });
  const target = {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const pointer = (clientY: number, timeStamp: number, pointerId = 1) =>
    ({
      clientY,
      timeStamp,
      pointerId,
      isPrimary: true,
      button: 0,
      currentTarget: target,
    }) as unknown as PointerEvent<HTMLElement>;
  const send = (
    type: 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel',
    y: number,
    time: number,
    id = 1,
  ) => {
    act(() => hook.result.current[type](pointer(y, time, id)));
  };
  return { ...hook, send };
}

describe('useBottomSheet gesture recovery', () => {
  it('keeps a slow drag at its destination across renders and ignores the following synthetic click', () => {
    const { result, rerender, send } = setup();
    send('onPointerDown', 500, 0);
    send('onPointerMove', 300, 1000);
    send('onPointerUp', 300, 1200);
    act(() => result.current.togglePeek());
    rerender({ results: true });
    expect(result.current.snap).toBe('full');
    expect(result.current.isDragging).toBe(false);
    // The next gesture starts from the new height, allowing full → half.
    send('onPointerDown', 300, 1300);
    send('onPointerMove', 490, 2300);
    send('onPointerUp', 490, 2500);
    expect(result.current.snap).toBe('half');
  });

  it('distinguishes a short flick from the same movement held before release', () => {
    const flick = setup(false);
    flick.send('onPointerDown', 600, 0);
    flick.send('onPointerMove', 575, 20);
    flick.send('onPointerUp', 575, 25);
    expect(flick.result.current.snap).toBe('half');
    const held = setup(false);
    held.send('onPointerDown', 600, 0);
    held.send('onPointerMove', 575, 20);
    held.send('onPointerUp', 575, 500);
    expect(held.result.current.snap).toBe('peek');
  });

  it('recovers after cancellation and ignores an unrelated pointer', () => {
    const { result, send } = setup();
    const initialHeight = result.current.sheetHeightPx;
    send('onPointerDown', 400, 0);
    send('onPointerMove', 200, 200, 2);
    expect(result.current.sheetHeightPx).toBe(initialHeight);
    send('onPointerMove', 200, 300);
    expect(result.current.sheetHeightPx).toBeGreaterThan(initialHeight);
    send('onPointerCancel', 200, 400);
    expect(result.current.sheetHeightPx).toBe(initialHeight);
    expect(result.current.isDragging).toBe(false);
    send('onPointerDown', 400, 500);
    send('onPointerUp', 400, 600);
    act(() => result.current.togglePeek());
    expect(result.current.snap).toBe('peek');
  });

  it('opens new results once and preserves the selected stop during refreshes', () => {
    const { result, rerender } = setup(false);
    expect(result.current.snap).toBe('peek');
    rerender({ results: true });
    expect(result.current.snap).toBe('half');
    act(() => result.current.transitionTo('peek'));
    rerender({ results: true });
    expect(result.current.snap).toBe('peek');
  });
});
