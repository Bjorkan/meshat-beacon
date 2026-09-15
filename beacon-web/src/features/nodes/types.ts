import type * as Models from '../../api/generated/models';
import type { NullableFields } from '../../api/model-types';

export type NodeIATA = Models.NodeIATA;
// Map/list state is also populated by partial WebSocket updates, which may lack these flags.
export type NodeSummary = NullableFields<
  Omit<Models.NodeSummary, 'isObserver' | 'stale'>,
  'name' | 'lat' | 'lng'
> &
  Partial<Pick<Models.NodeSummary, 'isObserver' | 'stale'>>;
export type NodeLinkMetric = Models.NodeLinkMetric;
export type Node = NodeSummary &
  NullableFields<
    Omit<Models.Node, keyof Models.NodeSummary | 'metadata' | 'neighbors'>,
    'locationSource' | 'lastAdvertAt' | 'minFirmwareVersion'
  > & { metadata: Record<string, unknown> | null };
// Neighbor presentations also accept historical data without sample counts; REST always supplies them.
export type NodeNeighbor = Omit<Models.NodeNeighbor, 'snrSampleCount'> &
  Partial<Pick<Models.NodeNeighbor, 'snrSampleCount'>>;
export type NodeObservation = Models.PacketObservationSummary;
