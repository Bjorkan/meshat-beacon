import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ObserverTable,
  type ObserverTableViewState,
} from '../../../src/features/observers/ObserverTable';
import { getObserversPage } from '../../../src/api/client';

vi.mock('../../../src/api/client', () => ({
  getObserversPage: vi.fn(),
  getBrokers: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../src/hooks/useRegion', () => ({
  useRegion: () => ({ regionKey: 'STO', iatas: ['STO'] }),
}));
vi.mock('../../../src/hooks/useScopes', () => ({ useScopes: () => [] }));
afterEach(() => vi.restoreAllMocks());

it('uses stable mobile sort IDs for fresh server pages while preserving region and filters', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.mocked(getObserversPage).mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  function Harness() {
    const [viewState, setViewState] = useState<ObserverTableViewState>({
      sort: { columnId: 'name', direction: 'asc' },
      typeFilter: '',
      brokerFilter: '',
      statusFilter: '',
      scopeFilter: '',
      search: '',
      searchField: 'name',
    });
    return (
      <ObserverTable
        selectedObserverId={null}
        onSelectObserver={vi.fn()}
        viewState={viewState}
        onViewStateChange={(patch) => setViewState((prev) => ({ ...prev, ...patch }))}
      />
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  const choices = [
    ['Name A–Z', 'name', 'asc'],
    ['Name Z–A', 'name', 'desc'],
    ['Online first', 'status', 'desc'],
    ['Offline first', 'status', 'asc'],
  ];
  const bar = await screen.findByLabelText('Sort');
  expect(
    within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(choices.map(([label]) => label));
  expect(screen.getByRole('button', { name: 'Name A–Z' })).toHaveAttribute('aria-pressed', 'true');
  for (const [label, sort, direction] of choices) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(getObserversPage).toHaveBeenLastCalledWith(
        ['STO'],
        expect.objectContaining({
          sort,
          direction,
          type: undefined,
          cursor: undefined,
          pageToken: undefined,
        }),
      ),
    );
    expect(await screen.findByRole('button', { name: label })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
});
