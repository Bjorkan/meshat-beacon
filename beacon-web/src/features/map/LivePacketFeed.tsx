import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WsManager } from "../../api/ws-manager";
import { Badge } from "../../components/Badge";
import { ScopeTag } from "../../components/ScopeTag";
import { Timestamp } from "../../components/Timestamp";
import { payloadTypeVariant } from "../../components/badge-utils";
import { useWsPacketHandler } from "../../hooks/useWsHandlers";
import type { WsPacketObservation } from "../../types/ws";
import { PAYLOAD_TYPE_NAMES, type PayloadTypeValue } from "../../types/enums";
import { livePacketEntry, pushLivePacket, type LivePacketEntry } from "./live-packet-feed";
import { packetFlowColor } from "./packet-flow-colors";

interface LivePacketFeedProps {
  active: boolean;
  resetKey: string;
  selectedIatas: string[] | undefined;
  wsManager: WsManager;
  onOpenPacket: (packetHash: string) => void;
}

export function LivePacketFeed({ active, resetKey, selectedIatas, wsManager, onOpenPacket }: LivePacketFeedProps) {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<{ key: string; entries: LivePacketEntry[] }>({ key: resetKey, entries: [] });
  const [panelOpen, setPanelOpen] = useState(true);

  const handlePacket = useCallback((data: WsPacketObservation["data"]) => {
    if (!active) return;
    if (selectedIatas?.length && !selectedIatas.includes(data.observation.iata)) return;
    setFeed((current) => ({
      key: resetKey,
      entries: pushLivePacket(current.key === resetKey ? current.entries : [], livePacketEntry(data)),
    }));
  }, [active, resetKey, selectedIatas]);
  useWsPacketHandler(wsManager, handlePacket);

  const entries = feed.key === resetKey ? feed.entries : [];

  if (!active) return null;

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        aria-label={t("map.showLivePackets")}
        title={t("map.showLivePackets")}
        className="absolute top-3 right-14 z-10 flex items-center gap-2 rounded-full border border-border bg-bg-raised/95 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted shadow-lg backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-text-bright cursor-pointer"
      >
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
        </span>
        {t("map.livePackets")}
      </button>
    );
  }

  return (
    <section
      aria-label={t("map.livePackets")}
      className="absolute top-3 right-14 z-10 w-[360px] max-w-[calc(100%_-_4.25rem)] overflow-hidden rounded-lg border border-border bg-bg-raised/95 shadow-xl backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
          {t("map.livePackets")}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-green">
            <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden />
            {t("map.live")}
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label={t("map.hideLivePackets")}
            title={t("map.hideLivePackets")}
            className="-mr-1 flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-text-normal/5 hover:text-text-bright cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {entries.length === 0 && (
          <div className="px-3 py-3 text-center font-mono text-[10px] text-text-dim">
            {t("map.waitingForPackets")}
          </div>
        )}
        {entries.map((entry) => {
          const color = packetFlowColor(entry.packetHash);
          const typeName = PAYLOAD_TYPE_NAMES[entry.payloadType as PayloadTypeValue] ?? entry.payloadTypeName;
          return (
            <div
              key={entry.packetHash}
              data-packet-hash={entry.packetHash}
              data-packet-color={color}
              className="group flex min-h-9 items-center gap-1.5 px-2.5 py-1.5 transition-colors hover:bg-text-normal/5"
              style={{ boxShadow: `inset 3px 0 ${color}` }}
            >
              <Badge variant={payloadTypeVariant(entry.payloadType)}>{typeName}</Badge>
              {entry.hopCount != null && (
                <span className="rounded-sm bg-text-muted/8 px-1.5 py-px font-mono text-[10px] text-text-muted">
                  {entry.hopCount}+
                </span>
              )}
              {entry.scope && <ScopeTag>{entry.scope}</ScopeTag>}
              <span className="rounded-sm bg-green/10 px-1.5 py-px font-mono text-[10px] font-bold tracking-wide text-green">
                {entry.iata}
              </span>
              <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-text-dim">
                ×{entry.observationCount}
              </span>
              <Timestamp value={entry.heardAt} className="whitespace-nowrap font-mono text-[10px] text-text-muted" />
              <button
                type="button"
                onClick={() => onOpenPacket(entry.packetHash)}
                aria-label={t("map.openPacket", { hash: entry.packetHash })}
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
