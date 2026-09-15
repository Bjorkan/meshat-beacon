import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeNeighborRow } from '../../../src/features/nodes/NodeNeighborRow';
import type { NodeNeighbor } from '../../../src/features/nodes/types';

const neighbor: NodeNeighbor = {
  id: 'neighbor',
  publicKey: '8d55f035e4d3f73bd274887e9f3be60783b0c163',
  name: 'Relay',
  nodeType: 2,
  nodeTypeName: 'repeater',
  iata: 'STO',
  observationCount: 1234,
  firstSeen: 1,
  lastSeen: 2,
  snr: -3.25,
  snrSampleCount: 5,
  snrLastSeen: 1000,
};

describe('neighbor row inspection', () => {
  it('shows three-byte identity, full-key tooltip and trusted SNR with three filled bars', () => {
    render(<NodeNeighborRow neighbor={neighbor} />);
    expect(screen.getByText('8D55F0')).toHaveAttribute('title', neighbor.publicKey);
    const quality = screen.getByRole('img', { name: /-3.25 dB.*5.*Updated/ });
    expect(quality).toHaveAttribute('title', quality.getAttribute('aria-label'));
    expect(quality.querySelectorAll('rect[fill="currentColor"]')).toHaveLength(3);
    expect(screen.queryByText(neighbor.publicKey)).toBeNull();
  });
  it.each([{ snr: undefined }, { snr: null }, { snr: NaN }, { snrSampleCount: 0 }])(
    'shows deliberate unknown quality regardless of observation count: %j',
    (overrides) => {
      render(<NodeNeighborRow neighbor={{ ...neighbor, ...overrides } as NodeNeighbor} />);
      const quality = screen.getByRole('img', { name: /quality unknown/i });
      expect(quality.querySelectorAll('rect[fill="currentColor"]')).toHaveLength(0);
      expect(quality).toHaveTextContent('?');
    },
  );
  it('emits pointer and focus state separately while retaining ordinary navigation', () => {
    const onInteraction = vi.fn();
    const onClick = vi.fn();
    const { unmount } = render(
      <NodeNeighborRow neighbor={neighbor} onInteraction={onInteraction} onClick={onClick} />,
    );
    const row = screen.getByRole('button');
    fireEvent.mouseEnter(row);
    fireEvent.focus(row);
    fireEvent.mouseLeave(row);
    fireEvent.blur(row);
    expect(onInteraction.mock.calls).toEqual([
      ['neighbor', 'pointer', true],
      ['neighbor', 'focus', true],
      ['neighbor', 'pointer', false],
      ['neighbor', 'focus', false],
    ]);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.mouseEnter(row);
    unmount();
    expect(onInteraction).toHaveBeenLastCalledWith('neighbor', 'pointer', false);
  });
  it('works outside the map without an interaction callback', () => {
    const onClick = vi.fn();
    render(<NodeNeighborRow neighbor={{ ...neighbor, snr: 0 }} onClick={onClick} />);
    const row = screen.getByRole('button');
    fireEvent.focus(row);
    fireEvent.click(row);
    fireEvent.blur(row);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('img', { name: /0.00 dB/ })).toBeInTheDocument();
  });
});
