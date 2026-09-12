import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { regionQueries } from '../../src/api/queries';
import { getRegion, getRegions } from '../../src/api/client';
import { RegionProvider, useRegion } from '../../src/hooks/useRegion';

vi.mock('../../src/api/client', () => ({ getRegion: vi.fn(), getRegions: vi.fn() }));

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
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RegionProvider defaultSelection={{ regions: ['deployment'], iatas: [] }}>
          {children}
        </RegionProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useRegion(), { wrapper });
    await waitFor(() =>
      expect(result.current).toEqual(
        isRoot ? { iatas: undefined, regionKey: '*' } : { iatas: ['STO'], regionKey: 'STO' },
      ),
    );
  },
);
