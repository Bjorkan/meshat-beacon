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

// Traces are modest in number and the list isn't streamed, so a single region-filtered fetch covers
// the card list (the /traces cursor is sound if pagination is ever needed).
const TRACE_LIST_LIMIT = 200;

// "" = both; the backend takes TRACE or PING and omits the param to mean all.
interface TraceListProps {
  onAnalyze: (hash: string | null) => void;
  onViewNode?: (nodeId: string) => void;
  typeFilter: '' | TraceType;
  onTypeFilterChange: (value: '' | TraceType) => void;
}

// The desktop row carries the most complete observation's path, so scanners can read the hops
// (and the SNR heard on each) without opening the detail panel. Uniquely resolved hops show
// the node name; the raw prefix stays as secondary text for diagnostics. SNR renders inline
// in the chip title when present — no placeholder sub-line, so paths without SNR stay compact.
function TracePathPreview({
  hashes,
  snrs,
  resolved,
  overflow = 0,
  compact = false,
}: {
  hashes: string[];
  snrs: number[];
  resolved?: { confidence: string; nodeName?: string }[];
  overflow?: number;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? '' : 'mt-1.5 '}flex flex-wrap items-center gap-x-1 gap-y-1.5`}>
      {hashes.map((hash, i) => {
        const snr = snrs?.[i];
        const level = snr != null ? snrLevel(snr) : null;
        const sigClass = level ? SIGNAL_LEVEL_CLASSES[level] : 'text-text-normal';
        const hop = resolved?.[i];
        const named = hop?.confidence === 'high' && hop.nodeName;
        const title =
          snr != null ? `${hash.toUpperCase()} · ${formatSnr(snr)} dB` : hash.toUpperCase();
        return (
          <span key={i} className="inline-flex min-w-0 max-w-full shrink-0 items-center gap-1">
            {i > 0 && (
              <span className="text-text-dim" aria-hidden>
                →
              </span>
            )}
            <span
              className="inline-flex min-w-0 max-w-full flex-col items-center gap-0.5"
              title={named ? title : undefined}
            >
              <span className="max-w-full [overflow-wrap:anywhere] px-1.5 py-px rounded-sm bg-primary/6 text-primary font-mono text-[11px] font-semibold">
                {named ? hop.nodeName : hash.toUpperCase()}
              </span>
              {named && (
                <span className="font-mono text-[10px] text-text-dim">{hash.toUpperCase()}</span>
              )}
              {snr != null && (
                <span className={`font-mono text-[10px] ${sigClass}`}>{formatSnr(snr)} dB</span>
              )}
            </span>
          </span>
        );
      })}
      {overflow > 0 && <span className="font-mono text-[11px] text-text-dim">+{overflow}</span>}
    </div>
  );
}

const TRACE_PATH_PREVIEW_HOPS = 6;

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
      cell: (tag) =>
        tag.pathHashes?.length ? (
          <TracePathPreview
            hashes={tag.pathHashes.slice(0, TRACE_PATH_PREVIEW_HOPS)}
            snrs={(tag.snrValues ?? []).slice(0, TRACE_PATH_PREVIEW_HOPS)}
            resolved={tag.resolvedPath?.slice(0, TRACE_PATH_PREVIEW_HOPS)}
            overflow={tag.pathHashes.length - TRACE_PATH_PREVIEW_HOPS}
          />
        ) : (
          <span className="text-text-dim">{t('traces.noPath')}</span>
        ),
    },
    {
      header: 'First seen',
      label: t('traces.firstSeen'),
      className: 'text-text-muted',
      sortValue: (tag) => tag.firstHeardAt,
      cell: (tag) => <Timestamp value={tag.firstHeardAt} />,
    },
    {
      header: 'Last seen',
      label: t('traces.lastSeen'),
      className: 'text-text-muted',
      sortValue: (tag) => tag.lastHeardAt,
      cell: (tag) => <Timestamp value={tag.lastHeardAt} />,
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
        <Timestamp value={tag.lastHeardAt} className="ml-auto text-[11px] text-text-dim" />
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
  const [sort, setSort] = useState<SortState>({ header: 'Last seen', direction: 'desc' });
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
    <div className="flex flex-1 min-h-0">
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
        <DataTable
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
