import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseRetryAfter,
  shouldRetryQuery,
  noteRateLimited,
  noteRequestOk,
  resetRateLimit,
  getRateLimitedUntil,
  isRateLimited,
  subscribeRateLimit,
} from '../../src/api/rate-limit';
import { RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MAX_MS } from '../../src/lib/constants';

afterEach(() => {
  resetRateLimit();
  vi.useRealTimers();
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds as milliseconds', () => {
    expect(parseRetryAfter('7')).toBe(7_000);
  });

  it('reads an HTTP-date relative to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
    expect(parseRetryAfter('Wed, 02 Sep 2026 12:00:30 GMT')).toBe(30_000);
  });

  it('returns undefined for a missing or junk header', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });

  it('clamps absurd values to the ceiling', () => {
    expect(parseRetryAfter('9999')).toBe(RATE_LIMIT_MAX_MS);
  });
});

describe('shouldRetryQuery', () => {
  it('never retries a 429', () => {
    expect(shouldRetryQuery(0, { status: 429 })).toBe(false);
  });

  it('never retries a 404', () => {
    expect(shouldRetryQuery(0, { status: 404 })).toBe(false);
  });

  it('retries a 5xx twice then stops', () => {
    expect(shouldRetryQuery(0, { status: 500 })).toBe(true);
    expect(shouldRetryQuery(1, { status: 500 })).toBe(true);
    expect(shouldRetryQuery(2, { status: 500 })).toBe(false);
  });

  it('retries a network error', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('rate-limit store', () => {
  it('starts un-limited', () => {
    expect(getRateLimitedUntil()).toBeNull();
    expect(isRateLimited()).toBe(false);
  });

  it('noteRateLimited opens the window and notifies subscribers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const cb = vi.fn();
    const unsub = subscribeRateLimit(cb);

    noteRateLimited(5_000);

    expect(getRateLimitedUntil()).toBe(1_005_000);
    expect(isRateLimited()).toBe(true);
    expect(cb).toHaveBeenCalledOnce();
    unsub();
  });

  it('uses the default window when no Retry-After was given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    noteRateLimited();
    expect(getRateLimitedUntil()).toBe(1_000_000 + RATE_LIMIT_DEFAULT_MS);
  });

  it('is no longer limited once the window elapses, without needing any request', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cb = vi.fn();
    subscribeRateLimit(cb);
    noteRateLimited(5_000);
    cb.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(getRateLimitedUntil()).toBeNull();
    expect(isRateLimited()).toBe(false);
    expect(cb).toHaveBeenCalledOnce(); // expiry notifies the indicator
  });

  it('a successful overlapping response cannot clear an active Retry-After deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    noteRateLimited(10_000);
    // a parallel request that completes after the 429 must not shorten the backoff
    noteRequestOk();
    expect(getRateLimitedUntil()).toBe(10_000);
    expect(isRateLimited()).toBe(true);
    vi.advanceTimersByTime(9_999);
    expect(isRateLimited()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isRateLimited()).toBe(false);
  });

  it('a second 429 reschedules expiry, and the earlier window cannot clear it early', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    noteRateLimited(5_000);
    vi.advanceTimersByTime(2_000);
    noteRateLimited(10_000); // extends to t=12_000 and reschedules the expiry timer
    vi.advanceTimersByTime(3_000); // the original t=5_000 expiry point
    expect(getRateLimitedUntil()).toBe(12_000);
    expect(isRateLimited()).toBe(true);
    vi.advanceTimersByTime(7_000);
    expect(getRateLimitedUntil()).toBeNull();
  });

  it('a longer window extends, a shorter one does not shrink', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    noteRateLimited(5_000);
    noteRateLimited(10_000);
    expect(getRateLimitedUntil()).toBe(10_000);
    noteRateLimited(2_000);
    expect(getRateLimitedUntil()).toBe(10_000);
  });

  it('clears only already-expired state and stays quiet while the deadline is active', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cb = vi.fn();
    subscribeRateLimit(cb);

    noteRequestOk();
    expect(cb).not.toHaveBeenCalled();

    noteRateLimited(5_000);
    cb.mockClear();
    noteRequestOk(); // still active — must be a no-op
    expect(getRateLimitedUntil()).toBe(5_000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000); // expired
    noteRequestOk();
    expect(getRateLimitedUntil()).toBeNull();
  });
});
