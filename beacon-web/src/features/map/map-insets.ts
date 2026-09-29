import type { PaddingOptions } from 'maplibre-gl';

// CSS slots in MapView: settings at top:12, LIVE at bottom:16, loading at bottom:56.
// The app navigation is outside the map container, so its height must not be counted twice.
// LivePacketFeed occupies at most 40% of the (height - 108) overlay below 768px.
// On wider maps its right edge stays 60px clear of the navigation controls.
export function mapOverlayInsets(width: number, height: number, live: boolean): PaddingOptions {
  const narrow = width < 768;
  return {
    top: Math.min(112, height * 0.2),
    left: Math.min(40, width * 0.1),
    right: live && !narrow ? Math.min(432, width * 0.4) : Math.min(48, width * 0.12),
    bottom: Math.min(
      narrow ? (live ? 112 + Math.max(0, height - 108) * 0.4 : 112) : 96,
      height * 0.6,
    ),
  };
}
