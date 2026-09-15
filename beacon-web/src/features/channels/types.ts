import type * as Models from '../../api/generated/models';
import type { NullableFields } from '../../api/model-types';

export type ChannelKind = Models.ChannelKind;
export type ChannelSummary = NullableFields<Omit<Models.ChannelSummary, 'isHashtag'>, 'name'>;
export type ChannelDetail = ChannelSummary &
  Pick<Models.Channel, 'hashtag' | 'keyFingerprint' | 'messageCount'>;
// Live channel events carry no aggregated observation count yet.
export type ChannelMessage = Omit<Models.ChannelMessage, 'observationCount'> &
  Partial<Pick<Models.ChannelMessage, 'observationCount'>>;
export type ChannelPage = Omit<Models.ChannelPage, 'items' | 'nextCursor'> & {
  items: ChannelSummary[];
  nextCursor: number | null;
};

export function channelDisplayName(ch: ChannelSummary): string {
  if (!ch.name) return ch.channelHash;
  if (ch.kind === 'hashtag' || ch.kind === 'public') return ch.name;
  return `#${ch.name}`;
}
