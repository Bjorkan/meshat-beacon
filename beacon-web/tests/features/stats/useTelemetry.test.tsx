import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { getObserver } from '../../../src/api/client';
import { useObserver } from '../../../src/features/stats/useTelemetry';

vi.mock('../../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/api/client')>()),
  getObserver: vi.fn().mockResolvedValue({ id: 'observer-15', displayName: 'Observer 15' }),
}));

it('waits for selection before requesting an observer detail', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender } = renderHook(({ id }) => useObserver(id), {
    initialProps: { id: null as string | null },
    wrapper,
  });
  expect(result.current.isFetching).toBe(false);
  expect(getObserver).not.toHaveBeenCalled();
  rerender({ id: 'observer-15' });
  await waitFor(() => expect(result.current.data?.id).toBe('observer-15'));
  expect(getObserver).toHaveBeenCalledExactlyOnceWith('observer-15');
});
