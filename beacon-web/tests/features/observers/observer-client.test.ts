import { describe, expect, it } from 'vitest';
import {
  observerClientKey,
  observerClientLabel,
} from '../../../src/features/observers/observer-client';

describe('observer client presentation', () => {
  it.each([
    ['meshcore/v1.17.1.2-observer-8998409', 'meshcore', 'MeshCore'],
    ['meshcoretomqtt/1.3.0.0-preview', 'meshcoretomqtt', 'meshcoretomqtt'],
    ['meshcore-dev/meshcoretomqtt:1.1', 'meshcoretomqtt', 'meshcoretomqtt'],
    ['meshcore-dev/meshcore-ha', 'meshcore-ha', 'MeshCore HA'],
    ['meshcoreha', 'meshcore-ha', 'MeshCore HA'],
    ['kiekr-android', 'kiekr', 'KiekR'],
    ['custom/v1.2-build', 'custom/v1.2-build', 'custom'],
  ])('normalizes %s while retaining an exact key for unknown clients', (raw, key, label) => {
    expect(observerClientKey(raw)).toBe(key);
    expect(observerClientLabel(raw)).toBe(label);
  });
  it('does not infer a known family from a similar name', () => {
    expect(observerClientKey('meshcore-other/1.0')).toBe('meshcore-other/1.0');
    expect(observerClientLabel(undefined)).toBe('—');
  });
});
