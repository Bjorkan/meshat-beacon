import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { nodeQueries } from '../../api/queries';
import { useRegion } from '../../hooks/useRegion';
import { Section } from '../../components/DetailPanel';
import { Badge } from '../../components/Badge';
import { Timestamp } from '../../components/Timestamp';
import { InlinePacketPath } from '../packets/InlinePacketPath';
import { formatHex } from '../../lib/formatters';

export function NodePathPackets({
  nodeId,
  onAnalyzePacket,
}: {
  nodeId: string;
  onAnalyzePacket?: (hash: string) => void;
}) {
  const { t } = useTranslation();
  const { iatas, regionKey } = useRegion();
  const query = useInfiniteQuery(nodeQueries.pathPackets(nodeId, regionKey, iatas));
  const packets = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Section title={t('nodes.pathsThrough')}>
      <p className="mb-2 text-[11px] text-text-muted">{t('nodes.pathsThroughHint')}</p>
      {query.isLoading && (
        <p role="status" className="text-xs text-text-muted">
          {t('common.loading')}
        </p>
      )}
      {query.isError && (
        <div
          role="alert"
          className="mb-2 flex items-center justify-between gap-2 text-xs text-danger"
        >
          {t('common.failedToLoad')}
          <button
            type="button"
            disabled={query.isFetching}
            className="text-text-normal underline"
            onClick={() =>
              query.isFetchNextPageError ? void query.fetchNextPage() : void query.refetch()
            }
          >
            {t('common.tryAgain')}
          </button>
        </div>
      )}
      {!query.isLoading && !query.isError && packets.length === 0 && (
        <p className="text-xs text-text-dim">{t('nodes.noPathPackets')}</p>
      )}
      <div className="space-y-1.5">
        {packets.map((packet) => (
          <button
            key={packet.packetHash}
            type="button"
            disabled={!onAnalyzePacket}
            onClick={() => onAnalyzePacket?.(packet.packetHash)}
            className="w-full min-w-0 rounded border border-border bg-bg-base px-3 py-2 text-left hover:bg-text-normal/3 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="text-primary">{formatHex(packet.packetHash)}</span>
              <Badge variant="default">{packet.payloadTypeName}</Badge>
              <Timestamp value={packet.lastHeardAt} className="ml-auto text-text-dim" />
            </div>
            <div className="mt-1 text-[11px]">
              <InlinePacketPath packet={packet} />
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-text-muted">
              {packet.latestObserver?.displayName ?? packet.latestObserver?.id.slice(0, 8)} ·{' '}
              {packet.latestObserver?.iata} · ×{packet.observationCount}
            </div>
          </button>
        ))}
      </div>
      {query.hasNextPage && !query.isError && (
        <button
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
          className="mt-2 rounded border border-border px-3 py-2 font-mono text-xs text-text-normal disabled:opacity-50"
        >
          {query.isFetchingNextPage ? t('common.loading') : t('nodes.morePathPackets')}
        </button>
      )}
    </Section>
  );
}
