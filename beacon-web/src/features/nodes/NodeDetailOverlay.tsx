import { useTranslation } from 'react-i18next';
import { NodeDetailPanel } from './NodeDetailPanel';
import { ModalOverlay } from '../../components/ModalOverlay';

// Node detail shown as a modal over the packet analyzer: the panel sits where the packet drawer is
// (right side) and the rest dims, so a user can peek at a path hop's node and close back to the packet.
export function NodeDetailOverlay({
  nodeId,
  onClose,
  onViewObserver,
  onViewNode,
  onViewOnMap,
}: {
  nodeId: string;
  onClose: () => void;
  onViewObserver: (observerId: string) => void;
  onViewNode?: (nodeId: string) => void;
  onViewOnMap?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalOverlay label={t('nodes.detailLabel')} onClose={onClose}>
      <NodeDetailPanel
        nodeId={nodeId}
        onClose={onClose}
        onViewObserver={onViewObserver}
        onViewNode={onViewNode}
        onViewOnMap={onViewOnMap}
      />
    </ModalOverlay>
  );
}
