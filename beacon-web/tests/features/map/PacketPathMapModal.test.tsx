import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PacketDetail } from '../../../src/types/api';
import { PayloadType } from '../../../src/types/enums';

// stub the WebGL map; the modal's own logic is the selector + selection state
vi.mock('../../../src/features/map/PacketPathMap', () => ({
  PacketPathMap: ({ selectedKey }: { selectedKey: string | null }) => (
    <div data-testid="mini-map">{selectedKey ?? 'all'}</div>
  ),
}));

// the modal fetches the global 2-byte collision set for its 2-byte gate;
// default to "no collisions" so 2-byte fixtures draw unless a test overrides it
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[] }) =>
      options?.queryKey[1] === 'ambiguous-prefix2'
        ? { data: [] as string[] }
        : actual.useQuery(options as never),
  };
});

import { PacketPathMapModal } from '../../../src/features/map/PacketPathMapModal';

// this Node/jsdom combo leaves window.localStorage unavailable; stub it so nothing during the
// modal's render can throw on access.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

const hop = (id: string, lng: number, lat: number) => ({
  confidence: 'high' as const,
  nodes: [{ id, publicKey: 'pk', longitude: lng, latitude: lat }],
});
const detail = {
  packetHash: 'aabbccdd',
  header: { payloadType: PayloadType.TEXT, routeType: 1 },
  observations: [
    {
      id: 1,
      observerId: 'obs-alpha',
      observerName: 'Alpha',
      iata: 'YYZ',
      heardAt: 0,
      sourceBroker: 'b',
      // 3-byte hashes + nearby Västmanland hops: verifiable and drawable.
      pathLength: { raw: 'c2', hashSize: 3, hopCount: 2 },
      resolvedPath: [hop('a', 16.5, 59.6), hop('b', 16.52, 59.61)],
      propagationTimeMs: 100,
    },
    {
      id: 2,
      observerId: 'obs-bravo',
      observerName: 'Bravo',
      iata: 'YOW',
      heardAt: 0,
      sourceBroker: 'b',
      pathLength: { raw: 'c2', hashSize: 3, hopCount: 2 },
      resolvedPath: [hop('c', 16.54, 59.62), hop('d', 16.56, 59.63)],
      propagationTimeMs: 480,
    },
  ],
} as unknown as PacketDetail;

describe('PacketPathMapModal', () => {
  it('lists All paths plus a row per observer and starts on All', () => {
    render(<PacketPathMapModal detail={detail} onClose={() => {}} />);
    expect(screen.getByText('All paths')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByTestId('mini-map')).toHaveTextContent('all');
  });

  it('isolates a path when its row is clicked', () => {
    render(<PacketPathMapModal detail={detail} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Bravo'));
    expect(screen.getByTestId('mini-map')).toHaveTextContent('obs-bravo');
  });

  it("shows each observer's propagation", () => {
    render(<PacketPathMapModal detail={detail} onClose={() => {}} />);
    expect(screen.getByText('0.100s')).toBeInTheDocument(); // formatPropagation(100)
    expect(screen.getByText('0.480s')).toBeInTheDocument();
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<PacketPathMapModal detail={detail} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close path map'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('pre-selects the observer from initialSelectedKey', () => {
    render(
      <PacketPathMapModal detail={detail} onClose={() => {}} initialSelectedKey="obs-bravo" />,
    );
    expect(screen.getByTestId('mini-map')).toHaveTextContent('obs-bravo');
  });

  it("falls back to All when initialSelectedKey isn't a known path", () => {
    render(<PacketPathMapModal detail={detail} onClose={() => {}} initialSelectedKey="nope" />);
    expect(screen.getByTestId('mini-map')).toHaveTextContent('all');
  });

  it('renders a copy-link button', () => {
    render(<PacketPathMapModal detail={detail} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Copy path link' })).toBeInTheDocument();
  });

  it('explains a withheld 1-byte route instead of drawing it', () => {
    const shortHash = {
      ...detail,
      observations: detail.observations.map((o) => ({
        ...o,
        pathLength: { raw: '42', hashSize: 1, hopCount: 2 },
      })),
    } as unknown as PacketDetail;
    render(<PacketPathMapModal detail={shortHash} onClose={() => {}} />);
    // no observer rows: every candidate was withheld
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/1B hashes.*2B hashes/);
  });

  it('draws a 2-byte route when the DB reports no collisions', () => {
    const twoByte = {
      ...detail,
      observations: detail.observations.map((o) => ({
        ...o,
        pathLength: { raw: '82', hashSize: 2, hopCount: 2 },
        pathBytes: 'a1b2c3d4',
      })),
    } as unknown as PacketDetail;
    render(<PacketPathMapModal detail={twoByte} onClose={() => {}} />);
    // collision set is mocked empty: both observer rows draw
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('explains a 2-byte route with an ambiguous hop', () => {
    const ambiguous = {
      ...detail,
      observations: [
        {
          ...detail.observations[0],
          pathLength: { raw: '82', hashSize: 2, hopCount: 2 },
          pathBytes: 'a1b2c3d4',
          resolvedPath: [
            {
              confidence: 'ambiguous',
              nodes: [
                { id: 'x', publicKey: 'pa', longitude: 16.5, latitude: 59.6 },
                { id: 'y', publicKey: 'pb', longitude: 16.52, latitude: 59.61 },
              ],
            },
            hop('b', 16.54, 59.62),
          ],
        },
        {
          ...detail.observations[1],
          pathLength: { raw: '82', hashSize: 2, hopCount: 2 },
          pathBytes: 'e5f60708',
          resolvedPath: [
            {
              confidence: 'ambiguous',
              nodes: [
                { id: 'p', publicKey: 'pc', longitude: 16.56, latitude: 59.63 },
                { id: 'q', publicKey: 'pd', longitude: 16.58, latitude: 59.64 },
              ],
            },
            hop('d', 16.6, 59.65),
          ],
        },
      ],
    } as unknown as PacketDetail;
    render(<PacketPathMapModal detail={ambiguous} onClose={() => {}} />);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/more than one node/);
  });

  it('explains an MQTT-stitched route with an impossible leg', () => {
    const stitched = {
      ...detail,
      observations: [
        {
          ...detail.observations[0],
          resolvedPath: [hop('a', 16.5, 59.6), hop('far', 12.57, 55.68)],
        },
        {
          ...detail.observations[1],
          resolvedPath: [hop('c', 16.54, 59.62), hop('far2', 12.57, 55.68)],
        },
      ],
    } as unknown as PacketDetail;
    render(<PacketPathMapModal detail={stitched} onClose={() => {}} />);
    expect(screen.getByRole('note')).toHaveTextContent(/too far apart/);
  });

  describe('copy path link', () => {
    const writeText = vi.fn();

    beforeEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      });
      writeText.mockClear();
    });

    afterEach(() => window.history.replaceState({}, '', '/'));

    it('copies the selected path and strips the analyzer', () => {
      window.history.replaceState({}, '', '/?tab=Packets&hash=aabb&analyze=1');
      render(<PacketPathMapModal detail={detail} onClose={() => {}} />);
      fireEvent.click(screen.getByText('Bravo'));

      fireEvent.click(screen.getByRole('button', { name: 'Copy path link' }));

      const copied = new URL(writeText.mock.calls[0]![0] as string);
      expect(copied.searchParams.get('tab')).toBe('Packets');
      expect(copied.searchParams.get('hash')).toBe(detail.packetHash);
      expect(copied.searchParams.get('path')).toBe('obs-bravo');
      expect(copied.searchParams.has('analyze')).toBe(false); // path and analyze are exclusive
    });

    it('copies path=all when nothing is isolated', () => {
      render(<PacketPathMapModal detail={detail} onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Copy path link' }));
      expect(new URL(writeText.mock.calls[0]![0] as string).searchParams.get('path')).toBe('all');
    });
  });
});
