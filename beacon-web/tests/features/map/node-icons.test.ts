import { afterEach, describe, expect, it, vi } from 'vitest';
import { rasterizeNodeIcon } from '../../../src/features/map/node-icons';
import { NODE_TYPE_COLORS } from '../../../src/features/node-type-colors';

const roles = ['companion', 'repeater', 'room_server', 'sensor'] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
});

describe('map marker semantic colours', () => {
  it.each([true, false])(
    'keeps role colours distinct with colliding theme accents (dark=%s)',
    async (isDark) => {
      for (const token of ['primary', 'secondary', 'green', 'warn']) {
        document.documentElement.style.setProperty(`--palette-${token}`, '#111111');
      }
      const svgs: string[] = [];
      vi.stubGlobal(
        'Blob',
        class {
          constructor(parts: string[]) {
            svgs.push(parts.join(''));
          }
        },
      );
      vi.stubGlobal(
        'Image',
        class {
          onload?: () => void;
          set src(_url: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:marker');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const context = {
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ width: 72, height: 72, data: new Uint8ClampedArray() })),
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
      );
      for (const role of roles) {
        for (const suffix of ['', '-observer']) {
          expect(await rasterizeNodeIcon(`node-${role}${suffix}`, isDark)).not.toBeNull();
          expect(svgs.at(-1)).toContain(NODE_TYPE_COLORS[role]);
          expect(svgs.at(-1)).not.toContain('#111111');
        }
      }
      expect(await rasterizeNodeIcon('node-invalid', isDark)).toBeNull();
    },
  );
});
