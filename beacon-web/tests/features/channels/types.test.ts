import { describe, expect, it } from 'vitest';
import { channelDisplayName, type ChannelSummary } from '../../../src/features/channels/types';

function channel(overrides: Partial<ChannelSummary>): ChannelSummary {
  return {
    id: 1,
    name: null,
    channelHash: '11',
    lastSeen: 0,
    keyKnown: true,
    kind: 'private',
    ...overrides,
  };
}

describe('channelDisplayName', () => {
  it('uses semantic kind rather than the display name to identify Public', () => {
    expect(channelDisplayName(channel({ name: 'General', kind: 'public' }))).toBe('General');
    expect(channelDisplayName(channel({ name: 'Public', kind: 'private' }))).toBe('#Public');
  });

  it('keeps hashtag names intact', () => {
    expect(channelDisplayName(channel({ name: '#weather', kind: 'hashtag' }))).toBe('#weather');
  });
});
