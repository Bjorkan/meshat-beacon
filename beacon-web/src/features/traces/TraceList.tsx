import { useState, useEffect, useRef, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { traceQueries } from '../../api/queries';
import { useRegion } from '../../hooks/useRegion';
import { Timestamp } from '../../components/Timestamp';
import { Badge } from '../../components/Badge';
import { Segmented } from '../stats/Segmented';
import {
  DataTable,
  type Column,
  type MobileSortOption,
  type SortState,
} from '../../components/DataTable';
import { snrLevel, SIGNAL_LEVEL_CLASSES, formatSnr } from '../../lib/formatters';
import { TraceDetailPanel } from './TraceDetailPanel';
import type { TraceTagSummary, TraceType } from '../../types/api';

// Fetch a bounded page; DataTable mounts only the visible rows and its overscan.
const TRACE_LIST_LIMIT = 200;

// "" = both; the backend takes TRACE or PING and omits the param to mean all.
interface TraceListProps {
  onAnalyze: (hash: string | null) => void;
  onViewNode?: (nodeId: string) => void;
  typeFilter: '' | TraceType;
  onTypeFilterChange: (value: '' | TraceType) => void;
}

// The desktop row carries the most complete observation's path as single-line chips, like the
// Packet tab's Sökväg column (InlinePacketPath): resolved node names where confidence is high,
// otherwise the raw prefix, capped at 4 hops with a +N remainder. SNR[i] is hop i's reading of
// the link from hop i-1, so SNR[0] is skipped and the rest color the chip-border of the hop
// they enter — matching the backend's neighbor-edge semantics and the map's SNR scale.
const TRACE_PREVIEW_CHIP_CLASSES = {
  high: 'bg-green/8 text-green',
  ambiguous: 'bg-warn/8 text-warn',
  none: 'bg-text-muted/8 text-text-dim',
} as const;

function TracePathPreview({
  hashes,
  snrs,
  resolved,
  overflow = 0,
}: {
  hashes: string[];
  snrs: number[];
  resolved?: { confidence: string; nodeName?: string }[];
  overflow?: number;
}) {
  return (
    <span
      className="flex h-5 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap font-mono"
      title={hashes.map((h) => h.toUpperCase()).join(' → ')}
    >
      {hashes.map((hash, i) => {
        // SNR[i] is hop i's reading of the link from hop i-1: skip SNR[0] (no upstream link)
        // and render the rest as compact colored text after the hop they enter.
        const snr = i > 0 ? snrs?.[i] : undefined;
        const level = snr != null ? snrLevel(snr) : null;
        const sigClass = level ? SIGNAL_LEVEL_CLASSES[level] : 'text-text-normal';
        const hop = resolved?.[i];
        const confidence =
          hop?.confidence === 'high' || hop?.confidence === 'ambiguous' ? hop.confidence : 'none';
        const label = confidence === 'high' && hop?.nodeName ? hop.nodeName : hash.toUpperCase();
        const title =
          snr != null
            ? `${label} · ${hash.toUpperCase()} · ${formatSnr(snr)} dB`
            : label !== hash.toUpperCase()
              ? `${label} · ${hash.toUpperCase()}`
              : label;
        return (
          <span key={`${i}-${hash}`} className="contents">
            {i > 0 && (
              <span className="shrink-0 text-text-dim" aria-hidden>
                →
              </span>
            )}
            <span
              className={`max-w-28 shrink truncate rounded-sm px-1 py-px font-semibold ${TRACE_PREVIEW_CHIP_CLASSES[confidence]}`}
              title={title}
            >
              {label}
            </span>
            {snr != null && (
              <span className={`shrink-0 text-[10px] ${sigClass}`} title={title}>
                {formatSnr(snr)} dB
              </span>
            )}
          </span>
        );
      })}
      {overflow > 0 && <span className="shrink-0 text-text-dim">+{overflow}</span>}
    </span>
  );
}

const TRACE_PATH_PREVIEW_HOPS = 4;

function traceColumns(t: TFunction): Column<TraceTagSummary>[] {
  return [
    {
      header: 'Tag',
      sortValue: (tag) => tag.traceTag,
      cell: (tag) => (
        <span className="font-mono text-xs font-semibold text-primary tracking-wider">
          {tag.traceTag.toUpperCase()}
        </span>
      ),
    },
    {
      header: 'Type',
      label: t('traces.type'),
      className: 'text-text-muted',
      sortValue: (tag) => tag.traceType,
      cell: (tag) =>
        tag.traceType ? (
          <Badge variant={tag.traceType === 'PING' ? 'text' : 'trace'}>{tag.traceType}</Badge>
        ) : (
          <span className="text-text-dim">—</span>
        ),
    },
    {
      header: 'Packets',
      label: t('traces.packets'),
      className: 'text-text-muted',
      sortValue: (tag) => tag.packetCount,
      cell: (tag) => tag.packetCount.toLocaleString(),
    },
    {
      header: 'IATA',
      className: 'text-text-muted',
      sortValue: (tag) => tag.iataCount,
      cell: (tag) => tag.iataCount.toLocaleString(),
    },
    {
      header: 'Path',
      label: t('traces.path'),
      // Fixed single-line lane: virtualization only bounds the commit when every row
      // measures exactly estimateSize. Wrap + variable text = the measure pass becomes
      // the Firefox long task, so the preview clips to one 40px lane instead.
      cell: (tag) =>
        tag.pathHashes?.length ? (
          <span className="block h-5 overflow-hidden">
            <TracePathPreview
              hashes={tag.pathHashes.slice(0, TRACE_PATH_PREVIEW_HOPS)}
              snrs={(tag.snrValues ?? []).slice(0, TRACE_PATH_PREVIEW_HOPS)}
              resolved={tag.resolvedPath?.slice(0, TRACE_PATH_PREVIEW_HOPS)}
              overflow={tag.pathHashes.length - TRACE_PATH_PREVIEW_HOPS}
            />
          </span>
        ) : (
          <span className="text-text-dim">{t('traces.noPath')}</span>
        ),
    },
    {
      header: 'First seen',
      label: t('traces.firstSeen'),
      className: 'text-text-muted',
      sortValue: (tag) => tag.firstHeardAt,
      // Static text: 200 rows × 2 timestamps must not mount 400 ticker subscribers + tooltip trees.
      cell: (tag) => <Timestamp value={tag.firstHeardAt} static />,
    },
    {
      header: 'Last seen',
      label: t('traces.lastSeen'),
      className: 'text-text-muted',
      sortValue: (tag) => tag.lastHeardAt,
      cell: (tag) => <Timestamp value={tag.lastHeardAt} static />,
    },
  ];
}

// Semantic mobile sort actions for Traces: explicit user-facing orderings. Adding a sortable
// desktop column above never creates a mobile option by itself.
function traceMobileSortOptions(t: TFunction): MobileSortOption[] {
  return [
    { id: 'newest', label: t('sort.newest'), sort: { columnId: 'Last seen', direction: 'desc' } },
    { id: 'oldest', label: t('sort.oldest'), sort: { columnId: 'First seen', direction: 'asc' } },
    {
      id: 'most-packets',
      label: t('sort.mostPackets'),
      sort: { columnId: 'Packets', direction: 'desc' },
    },
  ];
}

// Mobile card: tag + type up top (the desktop row's identity), path preview, then the counts
// and recency a scanner needs. Mirrors renderRouteCard's shape so the tab reads like Routes.
function renderTraceCard(tag: TraceTagSummary, t: TFunction) {
  return (
    <div className="flex flex-col gap-1.5 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-primary tracking-wider">
          {tag.traceTag.toUpperCase()}
        </span>
        {tag.traceType && (
          <Badge variant={tag.traceType === 'PING' ? 'text' : 'trace'}>{tag.traceType}</Badge>
        )}
        <Timestamp value={tag.lastHeardAt} className="ml-auto text-[11px] text-text-dim" static />
      </div>
      {tag.pathHashes?.length ? (
        <TracePathPreview
          hashes={tag.pathHashes}
          snrs={tag.snrValues ?? []}
          resolved={tag.resolvedPath}
        />
      ) : null}
      <div className="text-[11px] text-text-dim">
        {t('traces.summary', { packets: tag.packetCount, iatas: tag.iataCount })}
      </div>
    </div>
  );
}

export function TraceList({
  onAnalyze,
  onViewNode,
  typeFilter,
  onTypeFilterChange,
}: TraceListProps) {
  const { t } = useTranslation();
  const { iatas, regionKey } = useRegion();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ columnId: 'Last seen', direction: 'desc' });
  const typeOptions = [
    { value: '', label: t('common.all') },
    { value: 'TRACE', label: 'Trace' },
    { value: 'PING', label: 'Ping' },
  ];

  // drop the selection when the region changes — the selected tag may not be in the new region
  const prevRegion = useRef(regionKey);
  useEffect(() => {
    if (prevRegion.current !== regionKey) {
      prevRegion.current = regionKey;
      setSelectedTag(null);
    }
  }, [regionKey]);

  const { data: tags, isLoading } = useQuery(
    traceQueries.list({ regionKey, iatas, type: typeFilter, limit: TRACE_LIST_LIMIT }),
  );

  const columns = useMemo(() => traceColumns(t), [t]);
  const mobileSortOptions = useMemo(() => traceMobileSortOptions(t), [t]);

  return (
    <div className="relative flex flex-1 min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="font-mono text-[11px] text-text-dim">
            {tags ? t('stats.traceCount', { count: tags.length }) : ''}
          </span>
          <Segmented
            options={typeOptions}
            value={typeFilter}
            onChange={(v) => onTypeFilterChange(v as '' | TraceType)}
            ariaLabel={t('traces.type')}
          />
        </div>
        {/* The virtualizer keeps its measurements across filter swaps only when the
            table stays mounted. A keyed remount would destroy all row measurements and force
            a full 200-row commit — so reset scroll + selection imperatively on filter change. */}
        <DataTable
          key={`${regionKey}:${typeFilter}`}
          virtualize
          columns={columns}
          rows={tags}
          rowKey={(tag) => tag.traceTag}
          selectedKey={selectedTag}
          onSelect={setSelectedTag}
          isLoading={isLoading}
          emptyLabel={t('traces.noTraces')}
          sort={sort}
          onSortChange={setSort}
          mobileSortOptions={mobileSortOptions}
          renderCard={(tag) => renderTraceCard(tag, t)}
        />
      </div>
      {selectedTag && (
        <TraceDetailPanel
          tag={selectedTag}
          onClose={() => setSelectedTag(null)}
          onAnalyze={onAnalyze}
          onViewNode={onViewNode}
        />
      )}
    </div>
  );
}
