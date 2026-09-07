import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PacketDetail } from '../../types/api';
import { PacketAnalyzerDrawer } from './PacketAnalyzerDrawer';
import { ModalOverlay } from '../../components/ModalOverlay';

// The route controller owns node overlays and packet replacement, keeping the stack bounded.
export function PacketAnalyzerOverlay({
  detail,
  loading,
  onClose,
  onViewNode,
  onViewPath,
  inactive = false,
}: {
  detail: PacketDetail | undefined;
  loading?: boolean;
  onClose: () => void;
  onViewNode: (nodeId: string) => void;
  onViewPath?: () => void;
  inactive?: boolean;
}) {
  const { t } = useTranslation();
  const [selectedObservationId, setSelectedObservationId] = useState<number | null>(null);

  return (
    <ModalOverlay label={t('packets.analyzerLabel')} onClose={onClose} inactive={inactive}>
      <PacketAnalyzerDrawer
        detail={detail}
        loading={loading}
        selectedObservationId={selectedObservationId}
        onSelectObservation={setSelectedObservationId}
        onClose={onClose}
        onViewNode={onViewNode}
        onViewPath={onViewPath}
      />
    </ModalOverlay>
  );
}
