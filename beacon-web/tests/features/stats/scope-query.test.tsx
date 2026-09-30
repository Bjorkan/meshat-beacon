import { afterEach, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useScopes } from '../../../src/features/stats/useStats';
import { getStatsScopes } from '../../../src/api/client';

const region = {
  status: 'resolved' as 'resolved' | 'pending' | 'all',
  iatas: ['YVR'] as string[] | null | undefined,
  regionKey: 'YVR' as string | null,
};
vi.mock('../../../src/hooks/useRegion', () => ({ useRegion: () => region }));
vi.mock('../../../src/api/client', () => ({ getStatsScopes: vi.fn(() => Promise.resolve([])) }));
afterEach(() => {
  vi.clearAllMocks();
  region.status = 'resolved';
  region.iatas = ['YVR'];
  region.regionKey = 'YVR';
});

it('sends the selected IATAs and fetches a separate global query when the filter is cleared', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender, unmount } = renderHook(() => useScopes(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() =>
    expect(getStatsScopes).toHaveBeenCalledWith(['YVR'], expect.any(AbortSignal)),
  );
  region.status = 'all';
  region.iatas = undefined;
  region.regionKey = '*';
  rerender();
  await waitFor(() =>
    expect(getStatsScopes).toHaveBeenCalledWith(undefined, expect.any(AbortSignal)),
  );
  expect(client.getQueryCache().findAll({ queryKey: ['stats-scopes'] })).toHaveLength(2);
  unmount();
  client.clear();
});

it('does not fetch a global fallback for unresolved selected regions', () => {
  region.status = 'pending';
  region.iatas = null;
  region.regionKey = null;
  const client = new QueryClient();
  const { unmount } = renderHook(() => useScopes(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  expect(getStatsScopes).not.toHaveBeenCalled();
  unmount();
  client.clear();
});
