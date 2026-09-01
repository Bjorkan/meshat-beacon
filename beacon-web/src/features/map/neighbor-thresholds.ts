// Shared thresholds for styling neighbour links by observation count and freshness. Both the map's
// line layer (useMapNeighbors) and the Analytics neighbour graph read these, so the two views can't
// drift apart.

// Observation counts are heavily right-skewed, so colour on a log10 axis: ~1 obs red, ~20 yellow,
// ~150+ green. Stops are log10(count) values.
export const OBS_STOPS = { danger: 0, warn: 1.3, green: 2.18 } as const;

// MeshCore/LoRa direct-link SNR semantics. Zero is valid signal data, never a missing sentinel.
export const SNR_STOPS = { danger: -15, warn: -5, green: 5 } as const;
export const NO_SNR_COLOR = '#3B82F6';

// A link's opacity fades with age — solid when fresh, faint by ~4 weeks (matches the 30-day retention).
export const AGE = { freshDays: 0, freshOp: 0.9, staleDays: 28, staleOp: 0.35 } as const;
