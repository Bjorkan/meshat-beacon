export type ChannelKind = 'public' | 'private' | 'hashtag' | 'unknown';

export interface ChannelSummary {
  id: number;
  name: string | null;
  channelHash: string;
  lastSeen: number; // epoch ms, time of most recent message
  keyKnown: boolean;
  kind: ChannelKind;
}

export interface ChannelDetail extends ChannelSummary {
  hashtag: string | null;
  keyFingerprint: string | null;
  messageCount: number;
}

export function channelDisplayName(ch: ChannelSummary): string {
  if (!ch.name) return ch.channelHash;
  if (ch.kind === 'hashtag' || ch.kind === 'public') return ch.name;
  return `#${ch.name}`;
}

export interface ChannelMessage {
  id: number;
  packetHash: string;
  channelHash: string;
  senderName: string;
  content: string;
  sentAt: number; // epoch ms, from the sender's embedded timestamp
  observationCount?: number;
}
