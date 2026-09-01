// Maps the Nodes-table search box (one shared input + a field selector) to the server params.
// The Public Key field is a hex prefix; non-hex input is dropped rather than sent, because the
// backend 400s on a non-hex pubkeyPrefix — so a stray character shows the unfiltered list instead
// of erroring the whole table.
export function nodeSearchParams(searchField: string, search: string): { name?: string; pubkeyPrefix?: string } {
  const value = search.trim();
  if (searchField === "pubkey") {
    const hex = value.toLowerCase();
    return { pubkeyPrefix: /^[0-9a-f]+$/.test(hex) ? hex : undefined };
  }
  return { name: value || undefined };
}
