import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPreference, writePreference } from '../../src/lib/storage';

afterEach(() => vi.unstubAllGlobals());

describe('optional preference storage', () => {
  it('handles denied reads and writes without breaking the caller', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    });
    expect(readPreference('theme')).toBeNull();
    expect(() => writePreference('theme', 'light')).not.toThrow();
  });

  it('tolerates unavailable storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readPreference('theme')).toBeNull();
    expect(() => writePreference('theme', 'light')).not.toThrow();
  });

  it('preserves preferences when storage is available', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    writePreference('theme', 'light');
    expect(readPreference('theme')).toBe('light');
    expect(readPreference('missing')).toBeNull();
  });
});
