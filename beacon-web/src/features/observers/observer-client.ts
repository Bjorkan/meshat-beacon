// Keep these family patterns aligned with the ListObservers SQL filter. Unknown clients
// retain their exact filter key; only known families group versions across stored rows.
const families = [
  { key: 'meshcore', label: 'MeshCore', pattern: /^(?:[^/]+\/)?meshcore(?:[/:]|$)/i },
  {
    key: 'meshcoretomqtt',
    label: 'meshcoretomqtt',
    pattern: /^(?:[^/]+\/)?meshcoretomqtt(?:[/:]|$)/i,
  },
  { key: 'meshcore-ha', label: 'MeshCore HA', pattern: /^(?:[^/]+\/)?meshcore-?ha(?:[/:]|$)/i },
  { key: 'kiekr', label: 'KiekR', pattern: /^(?:[^/]+\/)?kiekr(?:[-/:]|$)/i },
];

export function observerClientKey(raw: string): string {
  return families.find((family) => family.pattern.test(raw.trim()))?.key ?? raw;
}

export function observerClientLabel(raw: string | undefined): string {
  if (!raw) return '—';
  return (
    families.find((family) => family.pattern.test(raw.trim()))?.label ??
    raw.replace(/[/:]v?\d.*$/i, '')
  );
}
