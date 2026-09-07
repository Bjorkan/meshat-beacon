import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getChannelMessagesPage } from '../../../src/api/client';
import { MessagePanel } from '../../../src/features/channels/MessagePanel';
import type { ChannelMessage, ChannelSummary } from '../../../src/features/channels/types';

// live WS messages have no id — mirror that runtime shape in the page data
const restMsg: ChannelMessage = {
  id: 1,
  packetHash: 'ph-rest',
  channelHash: 'ch1',
  senderName: 'alice',
  content: 'from rest',
  sentAt: 1000,
};

const liveMsgA = {
  packetHash: 'ph-live-a',
  channelHash: 'ch1',
  senderName: 'bob',
  content: 'live one',
  sentAt: 2000,
} as ChannelMessage;

const liveMsgB = {
  packetHash: 'ph-live-b',
  channelHash: 'ch1',
  senderName: 'carol',
  content: 'live two',
  sentAt: 3000,
} as ChannelMessage;

const multiLineMsg: ChannelMessage = {
  id: 2,
  packetHash: 'ph-multiline',
  channelHash: 'ch1',
  senderName: 'dave',
  content: '🟠\nDWD aktuell: WARNUNG vor GEWITTER\nDi 17:37 - Di 19:00',
  sentAt: 4000,
};

vi.mock('../../../src/api/client', () => ({
  getChannelMessagesPage: vi.fn(() =>
    Promise.resolve({
      items: [restMsg, liveMsgA, liveMsgB, multiLineMsg],
      nextCursor: null,
      hasMore: false,
    }),
  ),
}));

const channel: ChannelSummary = {
  id: 1,
  name: 'Public',
  channelHash: 'ch1',
  lastSeen: 3000,
  isHashtag: false,
  keyKnown: true,
};

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('MessagePanel row keys', () => {
  it('keys rows without React key warnings when live messages lack an id', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MessagePanel channel={channel} heardCounts={{}} regionKey="*" />
      </QueryClientProvider>,
    );

    await screen.findByText('live two');
    expect(screen.getByText('from rest')).toBeInTheDocument();
    expect(screen.getByText('live one')).toBeInTheDocument();

    const keyWarnings = errorSpy.mock.calls.filter((args) => String(args[0]).includes('key'));
    expect(keyWarnings).toEqual([]);

    errorSpy.mockRestore();
  });
});

describe('MessagePanel multi-line messages', () => {
  it('preserves linebreaks in a message body', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MessagePanel channel={channel} heardCounts={{}} regionKey="*" />
      </QueryClientProvider>,
    );

    // jsdom doesn't collapse whitespace the way a browser does, so the class is what pins this;
    // the normalizer override stops findByText from collapsing the newlines before matching
    const body = await screen.findByText(multiLineMsg.content, { normalizer: (s) => s });
    expect(body.className).toContain('whitespace-pre-wrap');
    expect(body.className).toContain('break-words');
  });
});

describe('MessagePanel fetch errors', () => {
  it('shows a retry action instead of claiming a failed channel is empty', async () => {
    vi.mocked(getChannelMessagesPage).mockRejectedValueOnce(new Error('offline'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MessagePanel channel={channel} heardCounts={{}} regionKey="*" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Failed to load')).toBeInTheDocument();
    expect(screen.queryByText('No messages')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('from rest')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load')).not.toBeInTheDocument();
  });
});

it('keeps loaded messages and retries only the failed older page', async () => {
  const getPage = vi.mocked(getChannelMessagesPage);
  getPage.mockResolvedValueOnce({ items: [restMsg], nextCursor: 1, hasMore: true });
  getPage.mockRejectedValueOnce(new Error('older page offline'));
  getPage.mockResolvedValueOnce({
    items: [{ ...restMsg, id: 0, packetHash: 'older', content: 'older message' }],
    nextCursor: null,
    hasMore: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MessagePanel channel={channel} heardCounts={{}} regionKey="*" />
    </QueryClientProvider>,
  );
  await screen.findByText('from rest');
  fireEvent.scroll(container.querySelector('.overflow-y-auto')!);
  await screen.findByRole('alert');
  expect(screen.getByText('from rest')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(await screen.findByText('older message')).toBeInTheDocument();
  expect(screen.getByText('from rest')).toBeInTheDocument();
  expect(getPage).toHaveBeenLastCalledWith(1, { iatas: undefined, cursor: 1 });
});

it('offers an explicit action for a populated unselected workspace', () => {
  const select = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MessagePanel
        channel={null}
        suggestedChannel={channel}
        onSelectChannel={select}
        heardCounts={{}}
        regionKey="*"
      />
    </QueryClientProvider>,
  );
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open Public' }));
  expect(select).toHaveBeenCalledWith(channel.id);
});
