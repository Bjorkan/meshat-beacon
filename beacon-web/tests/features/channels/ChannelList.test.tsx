import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelList, type ChannelListViewState } from '../../../src/features/channels/ChannelList';
import { getChannels } from '../../../src/api/client';
import type { WsManager } from '../../../src/api/ws-manager';
import type { ChannelSummary } from '../../../src/features/channels/types';

const region = vi.hoisted(() => ({ regionKey: 'YVR', iatas: ['YVR'] }));
vi.mock('../../../src/hooks/useRegion', () => ({ useRegion: () => region }));
vi.mock('../../../src/hooks/useWsHandlers', () => ({ useWsChannelMessageHandler: () => {} }));
vi.mock('../../../src/features/channels/MessagePanel', () => ({ MessagePanel: () => null }));
vi.mock('../../../src/api/client', async (original) => ({
  ...(await original<typeof import('../../../src/api/client')>()),
  getChannels: vi.fn(),
}));
const known: ChannelSummary = {
  id: 1,
  name: 'General',
  channelHash: '11',
  lastSeen: 1000,
  keyKnown: true,
  kind: 'public',
};
const unknown: ChannelSummary = {
  id: 2,
  name: null,
  channelHash: 'ab',
  lastSeen: 2000,
  keyKnown: false,
  kind: 'unknown',
};
const defaults: ChannelListViewState = {
  search: '',
  searchField: 'name',
  keyFilter: '',
  hashtagFilter: '',
};

beforeEach(() => {
  region.regionKey = 'YVR';
  region.iatas = ['YVR'];
  vi.mocked(getChannels).mockReset();
});

function setup(view = defaults) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (state: ChannelListViewState) => (
    <QueryClientProvider client={client}>
      <ChannelList
        wsManager={{} as WsManager}
        onAnalyze={() => {}}
        viewState={state}
        onViewStateChange={() => {}}
      />
    </QueryClientProvider>
  );
  const result = render(element(view));
  return { ...result, update: (state = view) => result.rerender(element(state)) };
}

describe('ChannelList server aggregate', () => {
  it('keeps the total across pages and replaces it on region changes', async () => {
    vi.mocked(getChannels).mockImplementation(async (params) => {
      if (params?.iatas?.[0] === 'YYJ')
        return { items: [], unknownCount: 1, hasMore: false, nextCursor: null };
      return params?.pageCursor
        ? {
            items: [{ ...known, id: 3, name: 'Second' }],
            unknownCount: 80,
            hasMore: false,
            nextCursor: null,
          }
        : {
            items: [known],
            unknownCount: 80,
            hasMore: true,
            nextCursor: 1000,
            nextPageCursor: 'precise-page-2',
          };
    });
    const view = setup();
    expect(await screen.findByText('General')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('80 additional channels');
    expect(screen.queryByText('ab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('80 additional channels');
    region.regionKey = 'YYJ';
    region.iatas = ['YYJ'];
    view.update();
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '1 additional channel cannot be decrypted',
      ),
    );
    expect(screen.queryByText('General')).not.toBeInTheDocument();
  });

  it.each([
    { ...defaults, searchField: 'hash', search: 'AB' },
    { ...defaults, keyFilter: 'unknown' as const },
  ])('offers explicit unknown diagnostics for %j', async (state) => {
    vi.mocked(getChannels).mockResolvedValue({
      items: [unknown],
      unknownCount: 1,
      hasMore: false,
      nextCursor: null,
    });
    setup(state);
    expect(await screen.findByText('ab')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(getChannels).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: state.search ? 'ab' : undefined,
        key: state.keyFilter || undefined,
      }),
    );
  });
});
