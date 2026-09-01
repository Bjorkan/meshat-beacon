import { formatHex } from "../../lib/formatters";
import { useTranslation } from "react-i18next";
import { Timestamp } from "../../components/Timestamp";
import { Badge } from "../../components/Badge";
import { ScopeTag } from "../../components/ScopeTag";
import { payloadTypeVariant } from "../../components/badge-utils";
import { PAYLOAD_TYPE_NAMES, type PayloadTypeValue } from "../../types/enums";
import type { PacketSummary } from "../../types/api";
import { GRID_TEMPLATE } from "./packet-grid";
import { InlinePacketPath } from "./InlinePacketPath";

interface PacketTableRowProps {
  packet: PacketSummary;
  expanded: boolean;
  isFresh?: boolean;
  onToggle: () => void;
}

export function PacketTableRow({ packet, expanded, isFresh, onToggle }: PacketTableRowProps) {
  const { t } = useTranslation();
  const observer = packet.latestObserver;
  const pathLength = observer?.pathLength;
  const observerName = observer?.displayName ?? observer?.id.slice(0, 8);
  const area = observer?.iata;
  const observerTitle = observerName ? `${observerName}${area ? ` · ${area}` : ""}${observer?.id ? ` · ${observer.id}` : ""}` : undefined;
  const pathMeta = pathLength ? `${pathLength.hopCount}h · ${pathLength.hashSize}B` : null;
  const na = <span className="text-text-dim">n/a</span>;

  return (
    <div
      className={`border-b ${
        expanded
          ? "border-primary bg-primary/10"
          : isFresh
            ? "packet-fresh border-border-subtle"
            : "border-border-subtle hover:bg-bg-raised/50"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full items-center gap-x-2 px-2 py-1 text-left text-[11px] cursor-pointer"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        <span className={`text-text-dim transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden>
          ›
        </span>
        <span className="font-mono text-xs font-semibold text-primary tracking-wider">
          {formatHex(packet.packetHash)}
        </span>
        <span>
          <Badge variant={payloadTypeVariant(packet.payloadType)}>
            {PAYLOAD_TYPE_NAMES[packet.payloadType as PayloadTypeValue] ?? packet.payloadTypeName}
          </Badge>
        </span>
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          <span className="truncate">{packet.routeTypeName || t("packets.unknown")}</span>
          {packet.scope && <ScopeTag className="shrink-0">{packet.scope}</ScopeTag>}
        </span>
        <span className="min-w-0 truncate" title={observerTitle}>
          {observerName ? (
            <>
              <span className="font-medium text-text-normal">{observerName}</span>
              {area && <span className="text-text-dim"> · {area}</span>}
            </>
          ) : na}
        </span>
        <span className="min-w-0 overflow-hidden"><InlinePacketPath packet={packet} /></span>
        <span className="font-mono text-text-muted">×{packet.observationCount}</span>
        <span className="font-mono text-text-muted">{pathMeta ?? na}</span>
        <span className="text-right text-text-muted">
          <Timestamp value={packet.lastHeardAt} />
        </span>
      </button>
    </div>
  );
}
