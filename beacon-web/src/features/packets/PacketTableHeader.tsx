import { GRID_TEMPLATE, PACKET_TABLE_X_PADDING } from './packet-grid';
import { useTranslation } from 'react-i18next';

// Sticky above the virtualizer's spacer, never inside measured item space.
// The background and border-b run full-bleed to the scroll-surface edge; the
// shared PACKET_TABLE_X_PADDING keeps the cell content inside the same gutter
// the filter toolbar uses, so the table reads as one intentional surface.
export function PacketTableHeader() {
  const { t } = useTranslation();
  return (
    <div
      className={`hidden lg:grid sticky top-0 z-10 gap-x-2 ${PACKET_TABLE_X_PADDING} py-1 bg-bg-surface border-b border-border text-[9px] uppercase tracking-wider text-text-muted`}
      style={{ gridTemplateColumns: GRID_TEMPLATE }}
    >
      <span aria-hidden />
      <span>Hash</span>
      <span>{t('entities.type')}</span>
      <span>{t('routes.route')}</span>
      <span>{t('packets.observerArea')}</span>
      <span>{t('packets.path')}</span>
      <span>Obs</span>
      <span>{t('packets.hopsHash')}</span>
      <span className="text-right">{t('packets.age')}</span>
    </div>
  );
}
