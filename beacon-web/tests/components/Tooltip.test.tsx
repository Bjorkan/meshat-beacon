import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Tooltip } from '../../src/components/Tooltip';

// mobile/touch == no hover-capable pointer; desktop == has hover. Interaction modality keys off
// (hover: hover), not viewport width.
function setMobile(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: /hover: hover/.test(query) ? !mobile : mobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => vi.restoreAllMocks());

describe('Tooltip (desktop)', () => {
  it('shows on pointer hover', async () => {
    setMobile(false);
    render(
      <Tooltip label="tip text">
        <span>target</span>
      </Tooltip>,
    );
    const trigger = screen.getByText('target');

    fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('tip text');
  });

  it('shows the same information on keyboard focus and dismisses with Escape', async () => {
    setMobile(false);
    render(
      <Tooltip label="tip text">
        <button type="button">target</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'target' });
    fireEvent.focus(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('tip text');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('does not open on click', () => {
    setMobile(false);
    render(
      <Tooltip label="tip text">
        <span>target</span>
      </Tooltip>,
    );
    fireEvent.click(screen.getByText('target'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Tooltip (mobile)', () => {
  it('toggles on tap and dismisses on an outside pointerdown', async () => {
    setMobile(true);
    render(
      <div>
        <Tooltip label="tip text">
          <span>target</span>
        </Tooltip>
        <span>outside</span>
      </div>,
    );
    const trigger = screen.getByText('target');

    fireEvent.click(trigger);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('tip text');

    // Radix defers primary-pointer dismissal until the matching click so drags/selections do not
    // close the popover. A complete outside tap closes it.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('stops the tap from reaching a parent click handler', async () => {
    setMobile(true);
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <Tooltip label="tip text">
          <span>target</span>
        </Tooltip>
      </div>,
    );
    fireEvent.click(screen.getByText('target'));
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
