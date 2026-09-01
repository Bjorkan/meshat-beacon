import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomSheet } from '../../src/components/BottomSheet';

describe('BottomSheet mobile viewport contract', () => {
  it('uses dynamic viewport geometry and contains short-viewport scrolling', () => {
    render(
      <BottomSheet label="More" onClose={() => {}}>
        <button type="button">Item</button>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'More' });
    const overlay = dialog.previousElementSibling;
    expect(overlay).toHaveClass('inset-x-0', 'top-0', 'h-dvh');
    expect(overlay).not.toHaveClass('inset-0');
    expect(dialog).toHaveClass('max-h-[85dvh]', 'overflow-y-auto', 'overscroll-contain');
  });

  it('closes from the backdrop without treating panel interaction as a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet label="More" onClose={onClose}>
        <button type="button">Item</button>
      </BottomSheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Item' }));
    expect(onClose).not.toHaveBeenCalled();
    const overlay = screen.getByRole('dialog', { name: 'More' }).previousElementSibling!;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
