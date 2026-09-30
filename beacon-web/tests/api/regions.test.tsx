import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { regionQueries, nodeQueries } from '../../src/api/queries';
import { getRegion, getRegions, getNodesPage } from '../../src/api/client';
import { RegionProvider, useRegion } from '../../src/hooks/useRegion';
import { useInfinitePages } from '../../src/hooks/useInfinitePages';
import { RegionWatcher, WS_EVENTS } from '../../src/router';
import { wsManager } from '../../src/api/ws-instance';
import type { Region } from '../../src/types/api';

vi.mock('../../src/api/client', () => ({
  getRegion: vi.fn(),
  getRegions: vi.fn(),
  getNodesPage: vi.fn(),
}));

vi.mock('../../src/api/ws-instance', () => ({
  wsManager: { connect: vi.fn(), updateSubscription: vi.fn(), disconnect: vi.fn() },
}));

const NORDICS: Region = { id: 1, slug: 'nordics', name: 'Nordics', iatas: ['OSL', 'STO'] };

function wrapperFor(selection: { regions: string[]; iatas: string[] }, client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RegionProvider defaultSelection={selection}>{children}</RegionProvider>
    </QueryClientProvider>
  );
}

it('does not infer a Swedish root from the region name or slug', async () => {
  const region = { id: 1, slug: 'sverige', name: 'Sverige', iatas: ['STO'] };
  vi.mocked(getRegions).mockResolvedValue([region]);
  vi.mocked(getRegion).mockResolvedValue(region);
  const regions = await new QueryClient().fetchQuery(regionQueries.list());
  expect(regions[0]?.isRoot).toBeUndefined();
  expect(regions[0]?.shortCode).toBeUndefined();
});

it.each([true, false])(
  'resolves a stored root slug using only configured metadata (root=%s)',
  async (isRoot) => {
    const region = {
      id: 1,
      slug: 'deployment',
      name: 'Deployment',
      shortCode: 'DEP',
      isRoot,
      iatas: ['STO'],
    };
    vi.mocked(getRegions).mockResolvedValue([region]);
    vi.mocked(getRegion).mockResolvedValue(region);
    const client = new QueryClient();
    await client.fetchQuery(regionQueries.list());
    const wrapper = wrapperFor({ regions: ['deployment'], iatas: [] }, client);
    const { result } = renderHook(() => useRegion(), { wrapper });
    await waitFor(() =>
      expect(result.current).toEqual(
        isRoot
          ? { status: 'all', iatas: undefined, regionKey: '*' }
          : { status: 'resolved', iatas: ['STO'], regionKey: 'STO' },
      ),
    );
  },
);

it('keeps a specific selection pending — not all-regions — while region metadata loads', async () => {
  let resolveRegions: (value: Region[]) => void = () => {};
  vi.mocked(getRegions).mockReturnValue(
    new Promise<Region[]>((resolve) => {
      resolveRegions = resolve;
    }),
  );
  vi.mocked(getRegion).mockResolvedValue(NORDICS);

  const client = new QueryClient();
  const wrapper = wrapperFor({ regions: ['nordics'], iatas: [] }, client);
  const { result } = renderHook(() => useRegion(), { wrapper });

  // Unresolved interval: the pending state must be distinct from the all-regions representation.
  expect(result.current).toEqual({ status: 'pending', iatas: null, regionKey: null });

  resolveRegions([NORDICS]);
  await waitFor(() =>
    expect(result.current).toEqual({
      status: 'resolved',
      iatas: ['OSL', 'STO'],
      regionKey: 'OSL,STO',
    }),
  );
});

it('never issues an all-region REST request while the region filter is pending', async () => {
  let resolveRegions: (value: Region[]) => void = () => {};
  vi.mocked(getRegions).mockReturnValue(
    new Promise<Region[]>((resolve) => {
      resolveRegions = resolve;
    }),
  );
  vi.mocked(getRegion).mockResolvedValue(NORDICS);
  vi.mocked(getNodesPage).mockResolvedValue({
    items: [],
    nextCursor: null,
    hasMore: false,
  });

  const client = new QueryClient();
  const wrapper = wrapperFor({ regions: ['nordics'], iatas: [] }, client);

  function Probe() {
    const { iatas, regionKey } = useRegion();
    useInfinitePages({
      options: nodeQueries.list({ regionKey, iatas }),
      getId: (n) => n.id,
    });
    return null;
  }
  render(<Probe />, { wrapper });

  // Nothing may fetch while pending — the unfiltered request would be an all-regions query.
  expect(getNodesPage).not.toHaveBeenCalled();
  // And a pending filter is disabled even if a call site forgets its own gate.
  expect(nodeQueries.list({ regionKey: null, iatas: null }).enabled).toBe(false);

  resolveRegions([NORDICS]);
  await waitFor(() => expect(getNodesPage).toHaveBeenCalled());
  expect(getNodesPage).toHaveBeenCalledWith(['OSL', 'STO'], expect.anything());
});

it('does not subscribe the WebSocket to an all-region scope while the region filter is pending', async () => {
  let resolveRegions: (value: Region[]) => void = () => {};
  vi.mocked(getRegions).mockReturnValue(
    new Promise<Region[]>((resolve) => {
      resolveRegions = resolve;
    }),
  );
  vi.mocked(getRegion).mockResolvedValue(NORDICS);

  const client = new QueryClient();
  const wrapper = wrapperFor({ regions: ['nordics'], iatas: [] }, client);
  render(<RegionWatcher />, { wrapper });

  expect(wsManager.connect).not.toHaveBeenCalled();
  expect(wsManager.updateSubscription).not.toHaveBeenCalled();

  resolveRegions([NORDICS]);
  await waitFor(() => expect(wsManager.connect).toHaveBeenCalledTimes(1));
  expect(wsManager.connect).toHaveBeenCalledWith({ iatas: ['OSL', 'STO'], events: WS_EVENTS });
  // The scope change after the initial connect is applied in place, not by a reconnect.
  expect(wsManager.updateSubscription).toHaveBeenCalledWith({
    iatas: ['OSL', 'STO'],
    events: WS_EVENTS,
  });
  expect(wsManager.disconnect).not.toHaveBeenCalled();
});
