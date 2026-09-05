import { describe, expect, it } from 'vitest';
import {
  buildMeshcoreContactUri,
  meshcoreContactName,
  isFullPublicKey,
  isMeshcoreContactType,
} from '../../../src/features/nodes/meshcore-contact';
import { qrIsDark, qrModuleCount } from '../../../src/features/nodes/meshcore-qr';

const KEY = 'a'.repeat(64);

describe('buildMeshcoreContactUri', () => {
  it('builds the official contact URI for all four contact types', () => {
    for (const type of [1, 2, 3, 4]) {
      const uri = buildMeshcoreContactUri({ name: 'Relay', publicKey: KEY, nodeType: type });
      expect(uri).toBe(`meshcore://contact/add?name=Relay&public_key=${KEY}&type=${type}`);
    }
  });

  it('URL-encodes names', () => {
    const uri = buildMeshcoreContactUri({ name: 'My Relay & Co', publicKey: KEY, nodeType: 2 });
    expect(uri).toContain('name=My+Relay+%26+Co');
  });

  it('falls back to a stable identity when the name is missing', () => {
    expect(buildMeshcoreContactUri({ name: null, publicKey: KEY, nodeType: 2 })).toContain(
      `name=node-${KEY.slice(0, 8)}`,
    );
    expect(meshcoreContactName('  ', KEY)).toBe(`node-${KEY.slice(0, 8)}`);
  });

  it('refuses unknown node types and malformed keys', () => {
    expect(isMeshcoreContactType(9)).toBe(false);
    expect(buildMeshcoreContactUri({ name: 'X', publicKey: KEY, nodeType: 9 })).toBeNull();
    expect(isFullPublicKey('aabbcc')).toBe(false);
    expect(buildMeshcoreContactUri({ name: 'X', publicKey: 'aabbcc', nodeType: 2 })).toBeNull();
  });
});

describe('qr encoding', () => {
  it('renders a square matrix with finder patterns for a contact URI', () => {
    const uri = buildMeshcoreContactUri({ name: 'Relay', publicKey: KEY, nodeType: 2 })!;
    const size = qrModuleCount(uri);
    expect(size).toBeGreaterThanOrEqual(21);
    expect(size % 4).toBe(1); // QR sizes are 21 + 4*(version-1)
    // top-left finder: 7x7 border dark, center 3x3 dark
    expect(qrIsDark(uri, 0, 0)).toBe(true);
    expect(qrIsDark(uri, 0, 6)).toBe(true);
    expect(qrIsDark(uri, 6, 6)).toBe(true);
    expect(qrIsDark(uri, 3, 3)).toBe(true);
    // separator row/col around the finder is light
    expect(qrIsDark(uri, 7, 0)).toBe(false);
  });

  it('encodes a real-length contact URI (131 chars) at version 8', () => {
    const realKey = '52cf732836ee9f4d9e41f7d4ed94a728c6017864c78caa9b552470186467f268';
    const uri = buildMeshcoreContactUri({
      name: 'SE1275-TobbeWRepObs1',
      publicKey: realKey,
      nodeType: 2,
    })!;
    expect(uri.length).toBe(131);
    // version 8 = 49x49 modules at error correction M
    expect(qrModuleCount(uri)).toBe(49);
  });
});
