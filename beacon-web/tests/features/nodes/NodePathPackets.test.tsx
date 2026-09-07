import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NodePathPackets } from '../../../src/features/nodes/NodePathPackets';
import { getNodePathPackets } from '../../../src/api/client';
import type { PacketSummary } from '../../../src/types/api';

const region = vi.hoisted(() => ({ regionKey: 'YVR', iatas: ['YVR'] }));
vi.mock('../../../src/hooks/useRegion', () => ({ useRegion: () => region }));
vi.mock('../../../src/api/client', () => ({ getNodePathPackets: vi.fn() }));
const getPackets = vi.mocked(getNodePathPackets);
const packet = (hash: string): PacketSummary => ({
  packetHash: hash,
  payloadType: 5,
  payloadTypeName: 'ADVERT',
  routeType: 1,
  routeTypeName: 'FLOOD',
  firstHeardAt: 1,
  lastHeardAt: 2,
  observationCount: 2,
});
const page = (hash: string, next?: string) => ({
  items: [packet(hash)],
  nextCursor: null,
  nextPageToken: next,
  hasMore: !!next,
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const analyze = vi.fn();
  const view = () => (
    <QueryClientProvider client={client}>
      <NodePathPackets nodeId="repeater" onAnalyzePacket={analyze} />
    </QueryClientProvider>
  );
  return { ...render(view()), view, analyze };
}
beforeEach(() => {
  getPackets.mockReset();
  region.regionKey = 'YVR';
  region.iatas = ['YVR'];
});
describe('paths through node', () => {
  it('pages on the server, keeps earlier packets, and opens the selected packet', async () => {
    getPackets.mockResolvedValueOnce(page('aabb', 'snapshot')).mockResolvedValueOnce(page('ccdd'));
    const { analyze } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /AABB/ }));
    expect(analyze).toHaveBeenCalledWith('aabb');
    fireEvent.click(screen.getByRole('button', { name: /more packets/i }));
    await screen.findByRole('button', { name: /CCDD/ });
    expect(screen.getByRole('button', { name: /AABB/ })).toBeInTheDocument();
    expect(getPackets).toHaveBeenLastCalledWith('repeater', {
      iatas: ['YVR'],
      limit: 25,
      pageToken: 'snapshot',
    });
  });
  it('discards the previous region pages when the global selection changes', async () => {
    getPackets.mockResolvedValueOnce(page('aabb')).mockResolvedValueOnce(page('ccdd'));
    const result = setup();
    await screen.findByRole('button', { name: /AABB/ });
    region.regionKey = 'YYJ';
    region.iatas = ['YYJ'];
    result.rerender(result.view());
    await screen.findByRole('button', { name: /CCDD/ });
    expect(screen.queryByRole('button', { name: /AABB/ })).toBeNull();
    expect(getPackets).toHaveBeenLastCalledWith('repeater', {
      iatas: ['YYJ'],
      limit: 25,
      pageToken: undefined,
    });
  });
  it('preserves the first page and retries a failed next page', async () => {
    getPackets
      .mockResolvedValueOnce(page('aabb', 'snapshot'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page('ccdd'));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /more packets/i }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /AABB/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByRole('button', { name: /CCDD/ });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(getPackets).toHaveBeenLastCalledWith('repeater', {
      iatas: ['YVR'],
      limit: 25,
      pageToken: 'snapshot',
    });
  });
});
