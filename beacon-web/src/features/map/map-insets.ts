import type { PaddingOptions } from 'maplibre-gl';

// CSS slots in MapView: settings at top:12, LIVE at bottom:16, loading at bottom:56.
// The app navigation is outside the map container, so its height must not be counted twice.
// LivePacketFeed occupies at most 45% of the (height - 76) overlay on narrow screens.
export function mapOverlayInsets(width: number, height: number, live: boolean): PaddingOptions {
  const narrow = width < 640;
  return {
    top: Math.min(112, height * 0.2),
    left: Math.min(40, width * 0.1),
    right: live && !narrow ? Math.min(396, width * 0.4) : Math.min(48, width * 0.12),
    bottom: Math.min(
      narrow ? (live ? 88 + Math.max(0, height - 76) * 0.45 : 112) : 80,
      height * 0.6,
    ),
  };
}
