import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NodeTable, type NodeTableViewState } from '../../../src/features/nodes/NodeTable';
import { getNodesPage } from '../../../src/api/client';

vi.mock('../../../src/api/client', () => ({ getNodesPage: vi.fn() }));
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
  vi.mocked(getNodesPage).mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  function Harness() {
    const [viewState, setViewState] = useState<NodeTableViewState>({
      sort: { columnId: 'name', direction: 'asc' },
      typeFilter: 'REPEATER',
      pathsFilter: '',
      tracesFilter: '',
      scopeFilter: '',
      search: '',
      searchField: 'name',
    });
    return (
      <NodeTable
        selectedNodeId={null}
        onSelectNode={vi.fn()}
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
    ['Most neighbors', 'neighbors', 'desc'],
    ['Fewest neighbors', 'neighbors', 'asc'],
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
      expect(getNodesPage).toHaveBeenLastCalledWith(
        ['STO'],
        expect.objectContaining({
          sort,
          direction,
          type: 'REPEATER',
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
