import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/Badge';
import { Timestamp } from '../../components/Timestamp';
import { ResolvedHopBlock } from '../packets/PathData';
import { ScopeTag } from '../../components/ScopeTag';
import { formatSnr, snrLevel, SIGNAL_LEVEL_CLASSES } from '../../lib/formatters';
import type { RawHop, ResolvedHop, TracePacket } from '../../types/api';
import './TracePacketTable.css';

// rawPath and resolvedRoute are index-aligned. Keep one renderer across all container sizes.
function TraceHopChain({
  rawPath,
  resolvedRoute,
  onViewNode,
}: {
  rawPath: RawHop[];
  resolvedRoute: ResolvedHop[];
  onViewNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  if (rawPath.length === 0)
    return <span className="text-text-dim text-[11px] font-mono">{t('traces.noPath')}</span>;
  return (
    <div
      role="region"
      aria-label={t('traces.path')}
      tabIndex={0}
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-1 font-mono text-[13px]"
    >
      {rawPath.map((raw, i) => {
        const snr = raw.snr;
        const level = snr != null ? snrLevel(snr) : null;
        const sigClass = level ? SIGNAL_LEVEL_CLASSES[level] : 'text-text-normal';
        return (
          <span key={i} className="inline-flex min-w-0 max-w-[14rem] shrink-0 items-center gap-1">
            {i > 0 && (
              <span className="text-text-dim" aria-hidden>
                →
              </span>
            )}
            <span className="inline-flex min-w-0 max-w-full flex-col items-center gap-0.5">
              <ResolvedHopBlock
                hop={resolvedRoute[i]}
                label={raw.hash.toUpperCase()}
                onViewNode={onViewNode}
                showSnr={false}
                truncateLabel
              />
              {snr != null && (
                <span className={`text-[11px] ${sigClass}`}>{formatSnr(snr)} dB</span>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}

interface TracePacketTableProps {
  packets: TracePacket[];
  onAnalyze: (hash: string) => void;
  onViewNode?: (nodeId: string) => void;
}

export function TracePacketTable({ packets, onAnalyze, onViewNode }: TracePacketTableProps) {
  const { t } = useTranslation();
  return (
    <div className="trace-packets">
      {/* Explicit roles preserve table semantics when narrow rows use CSS grid. */}
      <table role="table" className="trace-packet-table font-mono text-[11px]">
        <caption className="pb-2 text-left text-text-dim">
          {t('traces.packet', { count: packets.length })}
        </caption>
        <colgroup>
          <col className="trace-type-column" />
          <col className="trace-time-column" />
          <col className="trace-time-column" />
          <col />
          <col className="trace-action-column" />
        </colgroup>
        <thead role="rowgroup" className="bg-bg-raised text-text-muted">
          <tr role="row">
            <th role="columnheader" scope="col">
              {t('filters.type')} / {t('filters.scope')}
            </th>
            <th role="columnheader" scope="col">
              {t('traces.firstHeard')}
            </th>
            <th role="columnheader" scope="col">
              {t('traces.lastHeard')}
            </th>
            <th role="columnheader" scope="col">
              {t('traces.path')}
            </th>
            <th role="columnheader" scope="col">
              {t('traces.analyze')}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {packets.map((pkt) => (
            <tr role="row" key={pkt.packetHash} className="bg-bg-base">
              <td role="cell" className="trace-type-cell">
                <div className="flex flex-wrap items-center gap-1 [overflow-wrap:anywhere]">
                  <Badge variant="default">{pkt.routeTypeName || t('packets.unknown')}</Badge>
                  {pkt.scope && <ScopeTag className="min-w-0">{pkt.scope}</ScopeTag>}
                </div>
              </td>
              <td role="cell">
                <span aria-hidden="true" className="trace-compact-label text-text-dim">
                  {t('traces.firstHeard')}{' '}
                </span>
                <Timestamp value={pkt.firstHeardAt} ms />
              </td>
              <td role="cell">
                <span aria-hidden="true" className="trace-compact-label text-text-dim">
                  {t('traces.lastHeard')}{' '}
                </span>
                <Timestamp value={pkt.lastHeardAt} ms />
              </td>
              <td role="cell" className="trace-path-cell">
                <TraceHopChain
                  rawPath={pkt.rawPath}
                  resolvedRoute={pkt.resolvedRoute}
                  onViewNode={onViewNode}
                />
              </td>
              <td role="cell" className="trace-action-cell">
                <button
                  type="button"
                  onClick={() => onAnalyze(pkt.packetHash)}
                  className="min-h-9 cursor-pointer rounded border border-border px-2 py-1 text-text-normal hover:border-text-dim hover:bg-bg-raised focus-visible:border-primary"
                >
                  {t('traces.analyze')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
