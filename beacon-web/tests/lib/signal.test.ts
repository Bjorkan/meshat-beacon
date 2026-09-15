import { describe, expect, it } from 'vitest';
import { snrBars, SNR_STOPS } from '../../src/lib/signal';

describe('shared SNR bars', () => {
  it.each([
    [-20, 1],
    [-15.01, 1],
    [SNR_STOPS.danger, 2],
    [-5.01, 2],
    [SNR_STOPS.warn, 3],
    [0, 3],
    [4.99, 3],
    [SNR_STOPS.green, 4],
    [20, 4],
  ])('maps %s dB to %s bars', (snr, bars) => expect(snrBars(snr, 2)).toBe(bars));
  it.each([null, undefined, NaN, Infinity])(
    'represents absent or invalid SNR as unknown: %s',
    (snr) => expect(snrBars(snr)).toBeNull(),
  );
  it('does not turn an explicit zero-sample aggregate into signal data', () => {
    expect(snrBars(5, 0)).toBeNull();
    expect(snrBars(0, 1)).toBe(3);
  });
});
