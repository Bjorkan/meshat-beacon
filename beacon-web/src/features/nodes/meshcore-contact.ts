// Canonical MeshCore contact URI builder shared by the QR code and the Add-as-contact action,
// so both always encode the exact same payload. Format per https://docs.meshcore.io/qr_codes/:
// meshcore://contact/add?name=<name>&public_key=<64-hex>&type=<1-4>

export const MESHCORE_CONTACT_TYPES = new Set([1, 2, 3, 4]);

export function isMeshcoreContactType(nodeType: number): boolean {
  return MESHCORE_CONTACT_TYPES.has(nodeType);
}

export function isFullPublicKey(publicKey: string | undefined | null): boolean {
  return typeof publicKey === 'string' && /^[0-9a-fA-F]{64}$/.test(publicKey);
}

// Stable readable fallback when a node has no name: short hex identity, matching the detail
// panel's existing formatHex fallback style without importing display helpers here.
export function meshcoreContactName(name: string | null | undefined, publicKey: string): string {
  if (name && name.trim().length > 0) return name;
  return `node-${publicKey.slice(0, 8).toLowerCase()}`;
}

export function buildMeshcoreContactUri(node: {
  name: string | null | undefined;
  publicKey: string;
  nodeType: number;
}): string | null {
  if (!isMeshcoreContactType(node.nodeType)) return null;
  if (!isFullPublicKey(node.publicKey)) return null;
  const params = new URLSearchParams({
    name: meshcoreContactName(node.name, node.publicKey),
    public_key: node.publicKey.toLowerCase(),
    type: String(node.nodeType),
  });
  return `meshcore://contact/add?${params.toString()}`;
}
