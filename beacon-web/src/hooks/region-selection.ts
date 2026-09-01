// Region selection: the geographic filter shared across the app. A selection is a set of region
// slugs (each expands to its member IATAs) plus individually-picked IATA codes. Everything downstream
// — query keys, REST params, WS subscription — works off the resolved, flattened IATA list, so these
// helpers are the single place that knows how a selection becomes a list of IATAs and a URL.

export interface RegionSelection {
  regions: string[]; // region slugs, e.g. "western-canada"
  iatas: string[]; // individual IATA codes, e.g. "YVR"
}

// The empty selection means "all regions" — no server-side filter.
export const ALL_REGIONS: RegionSelection = { regions: [], iatas: [] };

export function isAllRegions(s: RegionSelection): boolean {
  return s.regions.length === 0 && s.iatas.length === 0;
}

// Flatten a selection to the sorted, deduped IATA codes to query. Region slugs are expanded via
// regionIatas (slug → member codes); a slug missing from the map (details not loaded yet) contributes
// nothing. Returns undefined for an empty selection so callers can treat it as "no filter".
export function resolveIatas(
  selection: RegionSelection,
  regionIatas: ReadonlyMap<string, string[]>,
): string[] | undefined {
  if (isAllRegions(selection)) return undefined;
  const set = new Set<string>();
  for (const slug of selection.regions) {
    for (const code of regionIatas.get(slug) ?? []) set.add(code);
  }
  for (const code of selection.iatas) set.add(code);
  if (set.size === 0) return undefined;
  return [...set].sort();
}

// Stable query-key fragment for a resolved IATA list. "*" stands in for "all regions".
export function regionKey(iatas: string[] | undefined): string {
  return iatas && iatas.length > 0 ? iatas.join(",") : "*";
}

export function serializeSelection(selection: RegionSelection): string {
  return JSON.stringify(selection);
}

// Parse a stored selection, tolerating anything malformed by falling back to all-regions.
export function deserializeSelection(raw: string | null): RegionSelection {
  if (!raw) return ALL_REGIONS;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Array.isArray(parsed.regions) &&
      Array.isArray(parsed.iatas) &&
      parsed.regions.every((r: unknown) => typeof r === "string") &&
      parsed.iatas.every((i: unknown) => typeof i === "string")
    ) {
      return { regions: parsed.regions, iatas: parsed.iatas };
    }
  } catch {
    // fall through
  }
  return ALL_REGIONS;
}
