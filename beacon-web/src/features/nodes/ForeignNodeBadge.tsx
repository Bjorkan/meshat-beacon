import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/Badge';
import { Tooltip } from '../../components/Tooltip';

export function ForeignNodeBadge({ possiblyForeign }: { possiblyForeign?: boolean }) {
  const { t } = useTranslation();
  if (possiblyForeign !== true) return null;
  return (
    <Tooltip
      label={t('upstream.reported_position_is_outside_this_servers_configured_local_borders')}
    >
      <Badge variant="default">{t('upstream.possibly_foreign')}</Badge>
    </Tooltip>
  );
}
