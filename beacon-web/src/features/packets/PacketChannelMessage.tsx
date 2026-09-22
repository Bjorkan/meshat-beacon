import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { PacketDetail } from '../../types/api';
import { PayloadType } from '../../types/enums';
import { Timestamp } from '../../components/Timestamp';

export function PacketChannelMessage({ packet }: { packet: PacketDetail }) {
  const { t } = useTranslation();
  const payload = packet.parsedPayload;
  if (
    packet.header.payloadType !== PayloadType.GROUP_TEXT ||
    !payload ||
    typeof payload !== 'object'
  )
    return null;
  const message = payload.decrypted;
  if (
    !message ||
    typeof message !== 'object' ||
    !('content' in message) ||
    typeof message.content !== 'string'
  )
    return null;
  const channelId = 'channelId' in message ? message.channelId : undefined;

  return (
    <div className="mb-2 rounded border border-border-subtle bg-bg-base p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        {'sender' in message && typeof message.sender === 'string' && (
          <span className="font-semibold text-primary">{message.sender}</span>
        )}
        {'sentAt' in message && typeof message.sentAt === 'number' && (
          <Timestamp value={message.sentAt} className="text-text-dim" />
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-text-normal">{message.content}</div>
      {typeof channelId === 'number' && Number.isInteger(channelId) && channelId > 0 && (
        <Link
          to="/channels"
          search={(prev) => ({
            regions: prev.regions ?? [],
            iata: prev.iata ?? [],
            types: prev.types ?? [],
            routes: prev.routes ?? [],
            obs: prev.obs ?? [],
            scope: prev.scope ?? [],
            q: prev.q,
            sf: prev.sf,
            channel: channelId,
            message: packet.packetHash,
          })}
          className="inline-block mt-2 rounded-sm border border-border px-2 py-1 bg-bg-raised text-text-normal hover:bg-text-normal/3"
        >
          {t('packets.openInChannels')}
        </Link>
      )}
    </div>
  );
}
