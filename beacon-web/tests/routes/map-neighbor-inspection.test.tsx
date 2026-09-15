import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NeighborInteractionHandler } from '../../src/features/nodes/NodeNeighborRow';
import { MapRoute } from '../../src/routes/map-route';

const state = vi.hoisted(() => ({
  search: { node: 'selected' } as { node?: string },
  navigate: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => state.search,
  useNavigate: () => state.navigate,
}));
vi.mock('../../src/routes/overlays', () => ({ useOverlays: () => ({}) }));
vi.mock('../../src/api/ws-instance', () => ({ wsManager: {} }));
vi.mock('../../src/features/map/MapView', () => ({
  MapView: ({
    selectedNodeId,
    hoveredNeighborId,
  }: {
    selectedNodeId: string | null;
    hoveredNeighborId: string | null;
  }) => (
    <output data-testid="map" data-selected={selectedNodeId} data-neighbor={hoveredNeighborId} />
  ),
}));
vi.mock('../../src/features/nodes/NodeDetailPanel', () => ({
  NodeDetailPanel: ({
    onNeighborInteraction,
    onClose,
  }: {
    onNeighborInteraction: NeighborInteractionHandler;
    onClose: () => void;
  }) => (
    <>
      {['one', 'two'].map((id) => (
        <button
          key={id}
          onMouseEnter={() => onNeighborInteraction(id, 'pointer', true)}
          onMouseLeave={() => onNeighborInteraction(id, 'pointer', false)}
          onFocus={() => onNeighborInteraction(id, 'focus', true)}
          onBlur={() => onNeighborInteraction(id, 'focus', false)}
        >
          {id}
        </button>
      ))}
      <button onClick={onClose}>Close</button>
    </>
  ),
}));
beforeEach(() => {
  state.search = { node: 'selected' };
  state.navigate.mockReset();
});

it('combines keyboard and pointer inspection without navigating or changing selection', () => {
  render(<MapRoute />);
  const map = screen.getByTestId('map');
  fireEvent.focus(screen.getByText('one'));
  expect(map).toHaveAttribute('data-neighbor', 'one');
  fireEvent.mouseEnter(screen.getByText('two'));
  expect(map).toHaveAttribute('data-neighbor', 'two');
  fireEvent.mouseLeave(screen.getByText('two'));
  expect(map).toHaveAttribute('data-neighbor', 'one');
  fireEvent.blur(screen.getByText('one'));
  expect(map).not.toHaveAttribute('data-neighbor');
  expect(map).toHaveAttribute('data-selected', 'selected');
  expect(state.navigate).not.toHaveBeenCalled();
});
it('clears inspection on selection changes and panel close, including returning to the previous node', () => {
  const { rerender } = render(<MapRoute />);
  fireEvent.mouseEnter(screen.getByText('one'));
  state.search = { node: 'another' };
  rerender(<MapRoute />);
  expect(screen.getByTestId('map')).not.toHaveAttribute('data-neighbor');
  state.search = { node: 'selected' };
  rerender(<MapRoute />);
  expect(screen.getByTestId('map')).not.toHaveAttribute('data-neighbor');
  fireEvent.focus(screen.getByText('two'));
  state.search = {};
  rerender(<MapRoute />);
  expect(screen.getByTestId('map')).not.toHaveAttribute('data-neighbor');
});
