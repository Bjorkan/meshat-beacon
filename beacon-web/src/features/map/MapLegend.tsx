import { useTranslation } from 'react-i18next';
import { NODE_TYPES } from '../../lib/node-types';
import { ObserverIcon } from '../../components/ObserverIcon';
import { NODE_TYPE_COLORS } from '../node-type-colors';
import { PACKET_FLOW_COLOR } from './types';

export function MapLegend({
  borders,
  neighbors,
  live,
  clustered,
  selected,
}: {
  borders: boolean;
  neighbors: boolean;
  live: boolean;
  clustered: boolean;
  selected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details className="border-t border-border-subtle font-mono text-size-11 text-text-muted">
      <summary className="cursor-pointer px-3 py-2 hover:text-text-normal">
        {t('map.legend')}
      </summary>
      <div className="space-y-2 px-3 pb-2">
        <ul className="grid grid-cols-2 gap-x-2 gap-y-1">
          {NODE_TYPES.map((type) => (
            <li key={type.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full bg-(--legend-color)"
                style={{ '--legend-color': NODE_TYPE_COLORS[type.name] } as React.CSSProperties}
              />
              {type.label}
            </li>
          ))}
          <li className="col-span-2 flex items-center gap-1.5">
            <ObserverIcon />
            {t('entities.observer')}
          </li>
        </ul>
        {clustered && <p>{t('map.legendClusters')}</p>}
        {selected && (
          <p>
            <span aria-hidden className="text-primary">
              ◎{' '}
            </span>
            {t('map.legendSelected')}
          </p>
        )}
        {borders && (
          <p>
            <span aria-hidden className="text-secondary">
              —{' '}
            </span>
            {t('map.legendBorders')}
          </p>
        )}
        {live && (
          <p>
            <span
              aria-hidden
              className="text-(--legend-color)"
              style={{ '--legend-color': PACKET_FLOW_COLOR } as React.CSSProperties}
            >
              →{' '}
            </span>
            {t('map.legendLive')}
          </p>
        )}
        {neighbors && (
          <div className="space-y-1 border-t border-border pt-2">
            <p>{t('map.legendLinks')}</p>
            <p>
              <span className="text-danger">— </span>≤ −15 dB · ≈ 1 {t('stats.observations')}
            </p>
            <p>
              <span className="text-warn">— </span>−5 dB · ≈ 20 {t('stats.observations')}
            </p>
            <p>
              <span className="text-green">— </span>≥ 5 dB · ≥ 150 {t('stats.observations')}
            </p>
            <p>{t('map.legendLinkFallback')}</p>
          </div>
        )}
      </div>
    </details>
  );
}
