import { RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MAX_MS } from '../lib/constants';

// Kept free of client.ts imports so tests that mock the client with partial factories stay valid.

// Retry-After as milliseconds. The server sends delta-seconds; the HTTP-date form is legal too.
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  let ms: number;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return undefined;
    ms = at - Date.now();
  }
  return Math.min(Math.max(ms, 0), RATE_LIMIT_MAX_MS);
}

// TanStack Query retry predicate: a 4xx won't improve by asking again, and retrying a 429 is exactly
// what the server just asked us not to do. Two retries for everything else, as before.
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return true;
}

// App-wide "the API is throttling us" flag: fed by the fetch wrapper, read by the header badge.
// The absolute Retry-After deadline owns expiry — parallel requests complete out of order, so a
// generic 2xx response can never prove an earlier backoff instruction no longer applies.

let limitedUntil: number | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Self-validating: only the deadline it was scheduled for may clear the state, so a stale timer
// from an earlier window can never cancel a newer, longer backoff.
function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (limitedUntil === null) return;
  const deadline = limitedUntil;
  expiryTimer = setTimeout(
    () => {
      expiryTimer = null;
      if (limitedUntil === deadline) {
        limitedUntil = null;
        notify();
      }
    },
    Math.max(0, deadline - Date.now()),
  );
}

export function noteRateLimited(retryAfterMs: number = RATE_LIMIT_DEFAULT_MS): void {
  const until = Date.now() + retryAfterMs;
  if (limitedUntil !== null && until <= limitedUntil) return;
  limitedUntil = until;
  scheduleExpiry();
  notify();
}

// A 2xx cannot shorten an active server-directed backoff; it only clears state that has already
// expired (as a fallback for a throttled expiry timer).
export function noteRequestOk(): void {
  if (limitedUntil === null || Date.now() < limitedUntil) return;
  limitedUntil = null;
  scheduleExpiry();
  notify();
}

// Test/diagnostic reset: unconditionally clears the deadline.
export function resetRateLimit(): void {
  if (limitedUntil === null && expiryTimer === null) return;
  limitedUntil = null;
  scheduleExpiry();
  notify();
}

export function getRateLimitedUntil(): number | null {
  return limitedUntil;
}

export function isRateLimited(): boolean {
  return limitedUntil !== null && Date.now() < limitedUntil;
}

export function subscribeRateLimit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
