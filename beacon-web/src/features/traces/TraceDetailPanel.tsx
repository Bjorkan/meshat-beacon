import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { traceQueries } from '../../api/queries';
import { DetailPanel, Section } from '../../components/DetailPanel';
import { Timestamp } from '../../components/Timestamp';
import { Badge } from '../../components/Badge';
import { ScopeTag } from '../../components/ScopeTag';
import { ResolvedHopBlock } from '../packets/PathData';
import { formatSnr, snrLevel, SIGNAL_LEVEL_CLASSES } from '../../lib/formatters';
import { useTheme } from '../../hooks/useTheme';
import { mapStyleForTheme } from '../map/types';
import { buildTracePaths } from './trace-path';
import { TracePathMapLazy } from './TracePathMapLazy';
import type { TracePacket } from '../../types/api';

interface TraceDetailPanelProps {
  tag: string;
  onClose: () => void;
  onAnalyze: (hash: string) => void;
  onViewNode?: (nodeId: string) => void;
}

// En paketrad: Paketsökvägens hopplista som grund — nodnamn där upplösningen är säker,
// annars rått hash, med benets SNR i grannsystemets färg direkt efter hoppet det går in i.
function TraceLegList({
  pkt,
  onViewNode,
}: {
  pkt: TracePacket;
  onViewNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  if (pkt.rawPath.length === 0)
    return <span className="text-text-dim text-[11px] font-mono">{t('traces.noPath')}</span>;
  return (
    <ol className="flex min-w-0 flex-col">
      {pkt.rawPath.map((raw, i) => {
        const hop = pkt.resolvedRoute[i];
        // SNR[i] är hop i:s mätning av länken från hop i-1 (backendens neighbor-edge-semantik).
        const snr = i > 0 ? (raw.snr ?? null) : null;
        const level = snr != null ? snrLevel(snr) : null;
        const sigClass = level ? SIGNAL_LEVEL_CLASSES[level] : 'text-text-dim';
        return (
          <li
            key={`${pkt.packetHash}-${i}`}
            className="flex min-w-0 items-baseline gap-2 border-b border-border-subtle/60 py-1 font-mono text-[12px] last:border-b-0"
          >
            <span className="w-6 shrink-0 text-text-dim" aria-hidden>
              #{i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <ResolvedHopBlock
                hop={hop}
                label={raw.hash.toUpperCase()}
                onViewNode={onViewNode}
                showSnr={false}
                truncateLabel
              />
            </span>
            {snr != null ? (
              <span
                className={`shrink-0 tabular-nums ${sigClass}`}
                title={t('traces.legSnr', { from: i, to: i + 1, snr: formatSnr(snr) })}
              >
                {formatSnr(snr)} dB
              </span>
            ) : (
              <span className="shrink-0 text-text-dim" aria-hidden title={t('traces.noSnr')}>
                —
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Right-hand detail panel for a selected trace tag, matching the other entity tabs. The trace's
// packets stand in for the packet analyzer's "Observations": a "Packets" section listing each packet,
// any of which opens the packet analyzer.
export function TraceDetailPanel({ tag, onClose, onAnalyze, onViewNode }: TraceDetailPanelProps) {
  const { t } = useTranslation();
  const { data: detail, isLoading } = useQuery({
    ...traceQueries.detail(tag),
  });

  // most-recently-heard packet first (the backend order isn't guaranteed)
  const packets = useMemo(
    () => (detail ? [...detail.packets].sort((a, b) => b.lastHeardAt - a.lastHeardAt) : []),
    [detail],
  );
  const { paths, blocked } = useMemo(() => buildTracePaths(packets), [packets]);
  const { themeId } = useTheme();
  const styleId = useMemo(() => mapStyleForTheme(themeId), [themeId]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeKey =
    selectedKey && packets.some((p) => p.packetHash === selectedKey) ? selectedKey : null;
  const visiblePackets = activeKey ? packets.filter((p) => p.packetHash === activeKey) : packets;
  const blockedMessage =
    blocked == null
      ? null
      : blocked.reason === 'out-of-range'
        ? t('map.pathBlockedOutOfRange')
        : t('map.pathBlockedUnresolved');

  // The map section is informative, never load-bearing: it renders when at least one packet
  // resolved to drawable legs, explains why when everything was withheld, and stays out of
  // the way (no map chrome, no selector) while the packets are still loading.
  const showMapSection = paths.length > 0 || (!isLoading && packets.length > 0 && blocked != null);

  return (
    <DetailPanel title={tag.toUpperCase()} onClose={onClose} isLoading={isLoading} overlay>
      {showMapSection && (
        <Section title={t('map.packetPath')} first>
          {paths.length > 0 ? (
            <>
              <div className="trace-map h-[320px] min-h-0 overflow-hidden rounded border border-border bg-bg-base lg:h-[380px]">
                <TracePathMapLazy paths={paths} selectedKey={activeKey} styleId={styleId} />
              </div>
              <div
                className="mt-2 flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={t('map.packetPath')}
              >
                <button
                  type="button"
                  onClick={() => setSelectedKey(null)}
                  aria-pressed={activeKey === null}
                  className={`flex min-h-9 items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                    activeKey === null
                      ? 'border-primary-dim bg-primary/10 text-text-normal'
                      : 'border-border text-text-muted hover:border-primary-dim hover:text-text-normal'
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full bg-text-dim" aria-hidden />
                  {t('map.allPaths')}
                </button>
                {paths.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setSelectedKey((cur) => (cur === p.key ? null : p.key))}
                    aria-pressed={activeKey === p.key}
                    title={p.key.toUpperCase()}
                    className={`flex min-h-9 items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
                      activeKey === p.key
                        ? 'border-primary-dim bg-primary/10 text-text-normal'
                        : 'border-border text-text-muted hover:border-primary-dim hover:text-text-normal'
                    }`}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: p.color }}
                      aria-hidden
                    />
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 font-mono text-[11px] text-text-dim">{t('traces.mapSnrHint')}</p>
              {blockedMessage != null && (
                <p role="note" className="mt-1 font-mono text-[11px] text-text-muted">
                  {blockedMessage}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="font-mono text-[12px] text-text-normal">{t('map.noDrawablePaths')}</p>
              <p role="note" className="mt-1 font-mono text-[11px] text-text-muted">
                {blockedMessage ?? t('map.noDrawablePathsHint')}
              </p>
            </>
          )}
        </Section>
      )}
      <Section title={t('traces.packets')} first={!showMapSection}>
        {packets.length > 0 ? (
          <div className="trace-packets flex flex-col">
            <p className="sr-only">{t('traces.packet', { count: visiblePackets.length })}</p>
            {visiblePackets.map((pkt) => (
              <article
                key={pkt.packetHash}
                aria-label={pkt.packetHash.slice(0, 8).toUpperCase()}
                className="border-b border-border py-2 first:pt-0 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                  <span
                    title={pkt.packetHash.toUpperCase()}
                    className="font-semibold tracking-wider text-primary"
                  >
                    {pkt.packetHash.slice(0, 8).toUpperCase()}
                  </span>
                  <Badge variant="default">{pkt.routeTypeName || t('packets.unknown')}</Badge>
                  {pkt.scope && <ScopeTag className="min-w-0">{pkt.scope}</ScopeTag>}
                  <span className="text-text-dim">
                    {t('common.first')} <Timestamp value={pkt.firstHeardAt} ms />
                  </span>
                  <span className="text-text-dim">
                    {t('common.last')} <Timestamp value={pkt.lastHeardAt} ms />
                  </span>
                  <button
                    type="button"
                    onClick={() => onAnalyze(pkt.packetHash)}
                    className="ml-auto min-h-9 shrink-0 cursor-pointer rounded border border-border px-2 py-1 text-text-normal hover:border-text-dim hover:bg-bg-raised focus-visible:border-primary"
                  >
                    {t('traces.analyze')}
                  </button>
                </div>
                <div className="mt-1.5" role="group" aria-label={t('traces.path')}>
                  <TraceLegList pkt={pkt} onViewNode={onViewNode} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          !isLoading && (
            <span className="text-text-dim text-[11px] font-mono">{t('traces.noPackets')}</span>
          )
        )}
      </Section>
    </DetailPanel>
  );
}
