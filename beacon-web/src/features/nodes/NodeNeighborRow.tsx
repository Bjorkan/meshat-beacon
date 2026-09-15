import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/Badge';
import { IataChip } from '../../components/IataChip';
import { Timestamp } from '../../components/Timestamp';
import {
  formatAbsolute,
  formatHex,
  formatNodePrefix,
  formatSnr,
  SIGNAL_LEVEL_CLASSES,
  snrLevel,
} from '../../lib/formatters';
import { snrBars } from '../../lib/signal';
import { nodeTypeLabel } from '../../lib/node-types';
import type { NodeNeighbor } from './types';

export type NeighborInteractionHandler = (
  id: string,
  source: 'pointer' | 'focus',
  active: boolean,
) => void;

export function NodeNeighborRow({
  neighbor,
  onClick,
  onInteraction,
}: {
  neighbor: NodeNeighbor;
  onClick?: () => void;
  onInteraction?: NeighborInteractionHandler;
}) {
  const { t } = useTranslation();
  const active = useRef({ pointer: false, focus: false });
  useEffect(() => {
    const current = active.current;
    return () => {
      if (current.pointer) onInteraction?.(neighbor.id, 'pointer', false);
      if (current.focus) onInteraction?.(neighbor.id, 'focus', false);
    };
  }, [neighbor.id, onInteraction]);
  const interact = (source: 'pointer' | 'focus', entered: boolean) => {
    active.current[source] = entered;
    onInteraction?.(neighbor.id, source, entered);
  };
  const bars = snrBars(neighbor.snr, neighbor.snrSampleCount);
  const level = bars === null ? null : snrLevel(neighbor.snr);
  const qualityLabel =
    bars === null
      ? t('nodes.linkQualityUnknown')
      : [
          t('nodes.linkQualitySnr', { snr: formatSnr(neighbor.snr) }),
          neighbor.snrSampleCount == null
            ? null
            : t('nodes.linkQualitySamples', { count: neighbor.snrSampleCount }),
          neighbor.snrLastSeen == null
            ? null
            : t('nodes.linkQualityUpdated', { time: formatAbsolute(neighbor.snrLastSeen) }),
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-bg-base border border-border rounded px-3 py-2 cursor-pointer hover:bg-text-normal/3 focus-visible:outline-2 focus-visible:outline-primary"
      onMouseEnter={() => interact('pointer', true)}
      onMouseLeave={() => interact('pointer', false)}
      onFocus={() => interact('focus', true)}
      onBlur={() => interact('focus', false)}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={`font-mono font-semibold tracking-wider truncate ${neighbor.name ? 'text-primary' : 'text-text-dim italic'}`}
        >
          {neighbor.name ?? formatHex(neighbor.id)}
        </span>
        <Badge variant="default">
          {nodeTypeLabel(neighbor.nodeTypeName, t('options.unknown'))}
        </Badge>
        <IataChip>{neighbor.iata}</IataChip>
        <Timestamp
          value={neighbor.lastSeen}
          className="text-text-dim ml-auto font-mono text-[11px]"
        />
      </div>
      <div className="font-mono text-[11px] text-text-muted mt-1 flex items-center gap-2">
        <span
          title={qualityLabel}
          role="img"
          aria-label={qualityLabel}
          className={`inline-flex items-center gap-1 shrink-0 ${level ? SIGNAL_LEVEL_CLASSES[level] : 'text-text-dim'}`}
        >
          <svg width="24" height="18" viewBox="0 0 24 18" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <rect
                key={n}
                x={(n - 1) * 6 + 1}
                y={17 - n * 4}
                width="4"
                height={n * 4}
                rx="0.5"
                stroke="currentColor"
                fill={bars !== null && n <= bars ? 'currentColor' : 'none'}
              />
            ))}
          </svg>
          {bars === null && <span aria-hidden="true">?</span>}
        </span>
        <span className="shrink-0" title={neighbor.publicKey}>
          {formatNodePrefix(neighbor.publicKey)}
        </span>
        <span className="shrink-0 text-text-dim" aria-hidden="true">
          ·
        </span>
        <span>
          {t('stats.observationAbbrev', { count: neighbor.observationCount.toLocaleString() })}
        </span>
      </div>
    </button>
  );
}
