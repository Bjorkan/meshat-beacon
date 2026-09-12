// URL, table and API share these identifiers; display labels never participate in sorting.
export function nodeSortId(value: unknown): 'name' | 'type' | 'radio' | 'neighbors' {
  return value === 'type' || value === 'radio' || value === 'neighbors' ? value : 'name';
}
