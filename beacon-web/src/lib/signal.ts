// Shared LoRa link-quality boundaries for numeric indicators and map interpolation.
export const SNR_STOPS = { danger: -15, warn: -5, green: 5 } as const;

// Four monotonic bands split at the map's weak, intermediate and strong SNR stops.
// An omitted sample count supports older responses; an explicit zero never proves quality.
export function snrBars(snr: number | null | undefined, sampleCount?: number): number | null {
  if (snr == null || !Number.isFinite(snr) || (sampleCount !== undefined && !(sampleCount > 0)))
    return null;
  if (snr >= SNR_STOPS.green) return 4;
  if (snr >= SNR_STOPS.warn) return 3;
  if (snr >= SNR_STOPS.danger) return 2;
  return 1;
}
