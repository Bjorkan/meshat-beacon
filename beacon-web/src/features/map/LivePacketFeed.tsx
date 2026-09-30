import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WsManager } from '../../api/ws-manager';
import { Badge } from '../../components/Badge';
import { ScopeTag } from '../../components/ScopeTag';
import { Timestamp } from '../../components/Timestamp';
import { CloseButton } from '../../components/CloseButton';
import { payloadTypeVariant } from '../../components/badge-utils';
import { useWsPacketHandler } from '../../hooks/useWsHandlers';
import type { WsPacketObservation } from '../../types/ws';
import { PAYLOAD_TYPE_NAMES, type PayloadTypeValue } from '../../types/enums';
import {
  livePacketEntry,
  pushLivePacket,
  buildLiveFlowCandidate,
  type LivePacketEntry,
} from './live-packet-feed';
import { packetFlowColor } from './packet-flow-colors';

interface LivePacketFeedProps {
  active: boolean;
  resetKey: string;
  selectedIatas: string[] | null | undefined;
  wsManager: WsManager;
  onOpenPacket: (packetHash: string) => void;
}

export function LivePacketFeed({
  active,
  resetKey,
  selectedIatas,
  wsManager,
  onOpenPacket,
}: LivePacketFeedProps) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<{ key: string; entries: LivePacketEntry[] }>({
    key: resetKey,
    entries: [],
  });
  const [panelOpen, setPanelOpen] = useState(true);

  const handlePacket = useCallback(
    (data: WsPacketObservation['data']) => {
      if (!active) return;
      if (selectedIatas?.length && !selectedIatas.includes(data.observation.iata)) return;
      // Same renderability gate as the map animation: ineligible packets never enter the feed.
      if (!buildLiveFlowCandidate(data.observation)) return;
      setFeed((current) => ({
        key: resetKey,
        entries: pushLivePacket(
          current.key === resetKey ? current.entries : [],
          livePacketEntry(data),
        ),
      }));
    },
    [active, resetKey, selectedIatas],
  );
  useWsPacketHandler(wsManager, handlePacket);

  const entries = feed.key === resetKey ? feed.entries : [];

  if (!active) return null;

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        aria-label={t('map.showLivePackets')}
        title={t('map.showLivePackets')}
        className="relative ml-auto flex w-fit max-w-full shrink-0 items-center gap-2 rounded-md border border-border bg-bg-raised px-3 py-2 font-mono text-size-11 text-text-muted shadow-lg transition-colors hover:text-text-bright cursor-pointer"
      >
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
        </span>
        {t('map.livePackets')}
      </button>
    );
  }

  return (
    <section
      aria-label={t('map.livePackets')}
      className="relative ml-auto flex max-h-full min-h-0 min-w-0 w-90 max-w-full flex-col overflow-hidden rounded-md border border-border bg-bg-raised shadow-lg"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-3 py-1">
        <span className="flex items-center gap-1.5 font-mono text-size-11 text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden />
          {t('map.livePackets')}
        </span>
        <CloseButton
          onClose={() => setPanelOpen(false)}
          label={t('map.hideLivePackets')}
          className="-mr-1"
        />
      </div>
      <div className="min-h-0 max-h-48 overflow-y-auto overscroll-contain py-1">
        {entries.length === 0 && (
          <div className="px-3 py-3 text-center font-mono text-size-10 text-text-dim">
            {t('map.waitingForPackets')}
          </div>
        )}
        {entries.map((entry) => {
          const color = packetFlowColor(entry.packetHash);
          const typeName =
            PAYLOAD_TYPE_NAMES[entry.payloadType as PayloadTypeValue] ?? entry.payloadTypeName;
          return (
            <div
              key={entry.packetHash}
              data-packet-hash={entry.packetHash}
              data-packet-color={color}
              className="group flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 shadow-(--packet-accent-shadow) transition-colors hover:bg-text-normal/5"
              style={{ '--packet-accent-shadow': `inset 3px 0 ${color}` } as React.CSSProperties}
            >
              <Badge variant={payloadTypeVariant(entry.payloadType)}>{typeName}</Badge>
              {entry.scope && (
                <span className="min-w-0 truncate" title={entry.scope}>
                  <ScopeTag>{entry.scope}</ScopeTag>
                </span>
              )}
              <span className="shrink-0 rounded-sm bg-green/10 px-1.5 py-px font-mono text-size-10 font-bold tracking-wide text-green">
                {entry.iata}
              </span>
              <Timestamp
                value={entry.heardAt}
                className="ml-auto shrink-0 whitespace-nowrap font-mono text-size-10 text-text-muted"
              />
              <button
                type="button"
                onClick={() => onOpenPacket(entry.packetHash)}
                aria-label={t('map.openPacket', { hash: entry.packetHash })}
                className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border text-xs text-text-muted transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary cursor-pointer"
              >
                &gt;
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
