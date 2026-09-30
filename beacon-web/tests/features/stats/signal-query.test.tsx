import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSignalStats } from '../../../src/features/stats/useSignalStats';
import { getSignalStats } from '../../../src/api/client';
import type { StatsRange } from '../../../src/features/stats/types';

const region = {
  status: 'resolved' as 'resolved' | 'pending' | 'all',
  iatas: ['YVR'] as string[] | null | undefined,
  regionKey: 'YVR' as string | null,
};
vi.mock('../../../src/hooks/useRegion', () => ({ useRegion: () => region }));
vi.mock('../../../src/api/client', () => ({ getSignalStats: vi.fn(() => new Promise(() => {})) }));
afterEach(() => {
  vi.clearAllMocks();
  region.status = 'resolved';
  region.iatas = ['YVR'];
  region.regionKey = 'YVR';
});

it('blocks unresolved regions and then uses bounded minute windows and cancellation', async () => {
  region.status = 'pending';
  region.iatas = null;
  region.regionKey = null;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result, rerender, unmount } = renderHook(
    ({ range }: { range: StatsRange }) => useSignalStats(range),
    {
      initialProps: { range: '24h' },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  expect(result.current.isPending).toBe(true);
  expect(getSignalStats).not.toHaveBeenCalled();
  region.status = 'resolved';
  region.iatas = ['YVR'];
  region.regionKey = 'YVR';
  rerender({ range: '24h' });
  await waitFor(() => expect(getSignalStats).toHaveBeenCalledOnce());
  const first = vi.mocked(getSignalStats).mock.calls[0]!;
  expect(first[1] % 60_000).toBe(0);
  expect(first[1] - first[0]).toBe(24 * 3_600_000);
  expect(first[2]).toEqual(['YVR']);
  region.iatas = ['YOW'];
  region.regionKey = 'YOW';
  rerender({ range: '30d' });
  await waitFor(() => expect(getSignalStats).toHaveBeenCalledTimes(2));
  expect(first[3]?.aborted).toBe(true);
  const second = vi.mocked(getSignalStats).mock.calls[1]!;
  expect(second[1] - second[0]).toBe(30 * 24 * 3_600_000);
  expect(second[2]).toEqual(['YOW']);
  unmount();
  expect(second[3]?.aborted).toBe(true);
  client.clear();
});
