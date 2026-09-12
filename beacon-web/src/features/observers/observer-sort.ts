// URL, table and API share these identifiers; display labels never participate in sorting.
export function observerSortId(value: unknown): 'name' | 'type' | 'radio' | 'iata' | 'status' {
  return value === 'type' || value === 'radio' || value === 'iata' || value === 'status'
    ? value
    : 'name';
}
