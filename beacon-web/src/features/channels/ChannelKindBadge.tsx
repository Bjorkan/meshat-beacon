import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/Badge';
import type { ChannelKind } from './types';

const variants = {
  public: 'advert',
  private: 'text',
  hashtag: 'group',
  unknown: 'offline',
} as const;

export function ChannelKindBadge({ kind }: { kind: ChannelKind }) {
  const { t } = useTranslation();
  const label = kind === 'unknown' ? t('channels.noKey') : t(`channels.${kind}`);
  return <Badge variant={variants[kind]}>{label}</Badge>;
}
