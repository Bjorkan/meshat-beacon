import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NodeLocationMap } from '../../../src/features/nodes/NodeLocationMap';
import type { Node } from '../../../src/features/nodes/types';

const state = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), removed: vi.fn() }));
vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      on(event: string, cb: () => void) {
        state.handlers.set(event, cb);
      }
      addControl() {}
      getContainer() {
        return document.createElement('div');
      }
      getSource() {
        return undefined;
      }
      getLayer() {
        return undefined;
      }
      addSource() {}
      addLayer() {}
      setCenter() {}
      loaded() {
        return false;
      }
      remove() {
        state.removed();
      }
    },
    NavigationControl: class {},
    AttributionControl: class {},
  },
}));
beforeEach(() => {
  state.handlers.clear();
  state.removed.mockClear();
});
const node = { id: 'n1', lat: 59.3, lng: 18.1 } as Node;
it('shows loading and coordinates until the map loads', () => {
  render(<NodeLocationMap node={node} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading location map');
  expect(screen.getByText('59.30000, 18.10000')).toBeInTheDocument();
  act(() => state.handlers.get('load')!());
  expect(screen.queryByRole('status')).toBeNull();
});
it('keeps coordinates and offers a fresh map attempt after style or tile failure', () => {
  render(<NodeLocationMap node={node} />);
  act(() => state.handlers.get('error')!());
  act(() => state.handlers.get('load')!());
  expect(screen.getByRole('status')).toHaveTextContent('basemap could not load');
  expect(screen.getByText('59.30000, 18.10000')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.removed).toHaveBeenCalledOnce();
  expect(screen.getByRole('status')).toHaveTextContent('Loading location map');
});
