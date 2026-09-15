import type * as Models from '../../api/generated/models';

// lastStatusAt is patched into list state by WebSocket status events, not REST list rows.
export type ObserverSummary = Models.ObserverSummary & Pick<Models.Observer, 'lastStatusAt'>;
export type Observer = Omit<Models.Observer, 'statusMetadata'> & {
  statusMetadata?: Record<string, unknown>;
};
export type ObserverBroker = Models.ObserverBroker;
export type AdvertObservation = Models.AdvertObservation;
