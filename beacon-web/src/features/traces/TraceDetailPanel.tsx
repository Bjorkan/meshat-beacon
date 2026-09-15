import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { traceQueries } from '../../api/queries';
import { DetailPanel, Section } from '../../components/DetailPanel';
import { TracePacketTable } from './TracePacketTable';

interface TraceDetailPanelProps {
  tag: string;
  onClose: () => void;
  onAnalyze: (hash: string) => void;
  onViewNode?: (nodeId: string) => void;
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
  const packets = detail ? [...detail.packets].sort((a, b) => b.lastHeardAt - a.lastHeardAt) : [];

  return (
    <DetailPanel title={tag.toUpperCase()} onClose={onClose} isLoading={isLoading} wide>
      <Section title={t('traces.packets')} first>
        {packets.length > 0 ? (
          <TracePacketTable packets={packets} onAnalyze={onAnalyze} onViewNode={onViewNode} />
        ) : (
          <span className="text-text-dim text-[11px] font-mono">{t('traces.noPackets')}</span>
        )}
      </Section>
    </DetailPanel>
  );
}
