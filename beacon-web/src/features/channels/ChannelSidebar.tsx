import { useTranslation } from 'react-i18next';
import { Timestamp } from '../../components/Timestamp';
import { ChannelKindBadge } from './ChannelKindBadge';
import { channelDisplayName } from './types';
import type { ChannelSummary } from './types';

interface ChannelSidebarProps {
  channels: ChannelSummary[];
  unknownCount?: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function ChannelSidebar({
  channels,
  unknownCount = 0,
  selectedId,
  onSelect,
}: ChannelSidebarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col divide-y divide-border/40">
        {channels.map((ch) => {
          const isSelected = ch.id === selectedId;
          return (
            <button
              key={ch.id}
              onClick={() => onSelect(ch.id)}
              className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-primary/10 border-l-primary'
                  : 'border-l-transparent hover:bg-primary/5 hover:border-l-primary/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`font-mono text-xs truncate ${isSelected ? 'text-text-bright' : 'text-text-normal'}`}
                >
                  {channelDisplayName(ch)}
                </span>
                <Timestamp
                  value={ch.lastSeen}
                  className="text-[11px] text-text-dim ml-2 shrink-0"
                />
              </div>
              <div className="flex gap-1 mt-1">
                <ChannelKindBadge kind={ch.kind} />
              </div>
            </button>
          );
        })}
        {unknownCount > 0 && (
          <p className="px-3 py-3 text-xs text-text-muted" role="status">
            {t('channels.unknownSummary', { count: unknownCount })}
          </p>
        )}
      </div>
    </div>
  );
}
