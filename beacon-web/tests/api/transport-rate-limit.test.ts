import { afterEach, expect, it, vi } from 'vitest';
import { getIatas, getIataBorder, ApiError } from '../../src/api/client';
import { getRateLimitedUntil, resetRateLimit } from '../../src/api/rate-limit';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetRateLimit();
});

it.each([() => getIatas(), () => getIataBorder('STO')])(
  'shares Retry-After handling across generated and GeoJSON requests',
  async (request) => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('proxy throttled', { status: 429, headers: { 'Retry-After': '7' } }),
        ),
    );
    await expect(request()).rejects.toMatchObject({ status: 429, retryAfterMs: 7000 });
    expect(getRateLimitedUntil()).toBe(8000);
    // an overlapping success must not clear the still-active backoff
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await getIataBorder('STO');
    expect(getRateLimitedUntil()).toBe(8000);
  },
);

it('preserves typed API error bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'invalid_request', message: 'Bad region' } }),
          { status: 400 },
        ),
      ),
  );
  await expect(getIatas()).rejects.toEqual(new ApiError(400, 'invalid_request', 'Bad region'));
});
