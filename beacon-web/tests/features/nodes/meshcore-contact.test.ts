import { describe, expect, it } from 'vitest';
import {
  buildMeshcoreContactUri,
  meshcoreContactName,
  isFullPublicKey,
  isMeshcoreContactType,
} from '../../../src/features/nodes/meshcore-contact';
import { qrMatrix } from '../../../src/features/nodes/meshcore-qr';

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

describe('qrMatrix', () => {
  it('renders a square matrix with finder patterns for a contact URI', () => {
    const uri = buildMeshcoreContactUri({ name: 'Relay', publicKey: KEY, nodeType: 2 })!;
    const matrix = qrMatrix(uri);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    // top-left finder: 7x7 border dark, center 3x3 dark
    expect(matrix[0]![0]).toBe(true);
    expect(matrix[0]![6]).toBe(true);
    expect(matrix[6]![6]).toBe(true);
    expect(matrix[3]![3]).toBe(true);
  });
});
