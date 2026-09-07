// Preferences are optional: privacy settings and quota failures must not break the UI.
export function readPreference(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Keep the in-memory selection even when it cannot be persisted.
  }
}
