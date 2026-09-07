import { describe, expect, it, vi } from 'vitest';
import themes from '../../public/themes.json';
import { loadThemes } from '../../src/lib/themes';

function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const c = parseInt(v, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function verify(vars: Record<string, string>) {
  for (const text of ['dim', 'muted', 'normal', 'bright']) {
    for (const surface of ['base', 'surface', 'raised']) {
      const a = luminance(vars[`--palette-text-${text}`]!);
      const b = luminance(vars[`--palette-bg-${surface}`]!);
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        `${text} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
}
describe('readable theme text', () => {
  for (const theme of themes) it(theme.id, () => verify(theme.vars));
  it('also covers the offline fallback palette', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    try {
      verify((await loadThemes())[0]!.vars);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
