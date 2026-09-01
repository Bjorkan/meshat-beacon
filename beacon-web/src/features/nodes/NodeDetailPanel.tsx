import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { nodeQueries } from "../../api/queries";
import { Badge } from "../../components/Badge";
import { DetailPanel, Section, Field } from "../../components/DetailPanel";
import { CopyButton } from "../../components/CopyButton";
import { CopyLinkButton } from "../../components/CopyLinkButton";
import { IataChip } from "../../components/IataChip";
import { formatHex, formatSnr, snrLevel, formatRadio, formatClockDrift, SIGNAL_LEVEL_CLASSES } from "../../lib/formatters";
import { Timestamp } from "../../components/Timestamp";
import type { NodeObservation, NodeNeighbor } from "./types";

function NodeNeighborRow({ neighbor, onClick }: { neighbor: NodeNeighbor; onClick?: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className={`bg-bg-base border border-border rounded px-3 py-2 ${onClick ? "cursor-pointer hover:bg-text-normal/3" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span className={`font-mono font-semibold tracking-wider truncate ${neighbor.name ? "text-primary" : "text-text-dim italic"}`}>
          {neighbor.name ?? formatHex(neighbor.id)}
        </span>
        <Badge variant="default">{neighbor.nodeTypeName}</Badge>
        <IataChip>{neighbor.iata}</IataChip>
        <Timestamp value={neighbor.lastSeen} className="text-text-dim ml-auto font-mono text-[11px]" />
      </div>
      <div className="font-mono text-[11px] text-text-muted mt-1 flex items-center gap-2">
        <span className="truncate" title={neighbor.publicKey}>{neighbor.publicKey}</span>
        <span className="shrink-0 text-text-dim">·</span>
        <span className="shrink-0">{t("stats.observationAbbrev", { count: neighbor.observationCount.toLocaleString() })}</span>
      </div>
    </div>
  );
}

function NodeObservationRow({ obs, onClick }: { obs: NodeObservation; onClick?: () => void }) {
  const { t } = useTranslation();
  const level = snrLevel(obs.snr);
  return (
    <div
      className={`bg-bg-base border border-border rounded px-3 py-2 border-l-2 border-l-primary ${onClick ? "cursor-pointer hover:bg-text-normal/3" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-[11px] mb-1.5">
        <Badge variant="default">{obs.payloadTypeName}</Badge>
        <IataChip>{obs.iata}</IataChip>
        <Timestamp value={obs.heardAt} className="text-text-dim ml-auto font-mono text-[11px]" />
      </div>
      <div className="flex gap-5 font-mono text-xs">
        <div className="flex flex-col">
          <span className="text-text-dim text-[10px] font-medium uppercase tracking-wider">SNR</span>
          <span className={`font-medium ${level ? SIGNAL_LEVEL_CLASSES[level] : "text-text-normal"}`}>
            {formatSnr(obs.snr)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-text-dim text-[10px] font-medium uppercase tracking-wider">RSSI</span>
          <span className={`font-medium ${level ? SIGNAL_LEVEL_CLASSES[level] : "text-text-normal"}`}>
            {obs.rssi ?? "—"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-text-dim text-[10px] font-medium uppercase tracking-wider">{t("packets.hops")}</span>
          <span className="font-medium text-text-normal">{obs.hopCount ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

interface NodeDetailPanelProps {
  nodeId: string;
  onClose: () => void;
  onViewObserver: (observerId: string) => void;
  onViewNode?: (nodeId: string) => void;
  onAnalyzePacket?: (hash: string) => void;
}

export function NodeDetailPanel({ nodeId, onClose, onViewObserver, onViewNode, onAnalyzePacket }: NodeDetailPanelProps) {
  const { t } = useTranslation();
  const { data: node, isLoading } = useQuery(nodeQueries.detail(nodeId));

  const { data: observations } = useQuery(nodeQueries.observations(nodeId));

  const { data: neighbors } = useQuery(nodeQueries.neighbors(nodeId));

  const hasLocation = node != null && node.lat != null && node.lng != null;

  return (
    <DetailPanel
      title={t("nodes.detail")}
      onClose={onClose}
      collapsible
      headerAction={<CopyLinkButton to={`/nodes/${encodeURIComponent(nodeId)}`} params={{}} ariaLabel={t("nodes.copyLink")} />}
      isLoading={isLoading}
      notFound={!node}
      notFoundLabel={t("nodes.notFound")}
      notFoundIcon={
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-border">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      }
    >
      {node && (
        <>
          <Section title={t("details.summary")} first>
              <div className="flex items-center gap-2 mb-2">
                <span className={`font-mono text-xs font-semibold tracking-wider ${node.name ? "text-primary" : "text-text-dim italic"}`}>
                  {node.name ?? formatHex(node.id)}
                </span>
                <Badge variant="default">{node.nodeTypeName}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <div className="font-mono text-[13px] text-text-muted truncate min-w-0 flex-1" title={node.publicKey}>
                  {node.publicKey}
                </div>
                <CopyButton value={node.publicKey} ariaLabel={t("nodes.copyPublicKey")} className="shrink-0" />
              </div>
              {node.observerId && (
                <button
                  type="button"
                  onClick={() => onViewObserver(node.observerId!)}
                  className="mt-2 block font-mono text-[11px] text-primary hover:underline"
                >
                  {t("nodes.viewObserver")}
                </button>
              )}
            </Section>

            {(hasLocation || node.locationSource) && (
              <Section title={t("details.location")}>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[13px]">
                  {node.lat != null && <Field label="Lat" value={node.lat.toFixed(5)} />}
                  {node.lng != null && <Field label="Lng" value={node.lng.toFixed(5)} />}
                  {node.locationSource && <Field label={t("details.source")} value={node.locationSource} />}
                </div>
              </Section>
            )}

            <Section title={t("details.capabilities")}>
              <div className="flex flex-col gap-0.5 font-mono text-[13px]">
                {node.minFirmwareVersion && <Field label={t("details.minFirmware")} value={node.minFirmwareVersion} />}
                <Field label={t("filters.multibytePaths")} value={t(node.supportsMultibytePaths ? "common.yes" : "common.no")} />
                <Field label={t("filters.multibyteTraces")} value={t(node.supportsMultibyteTraces ? "common.yes" : "common.no")} />
                {node.radio && <Field label={t("entities.radio")} value={formatRadio(node.radio) ?? "—"} />}
                {node.defaultScope && <Field label={t("filters.scope")} value={node.defaultScope} />}
              </div>
            </Section>

            <Section title={t("details.timestamps")}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[13px]">
                <Field label={t("common.first")} value={<Timestamp value={node.firstSeen} />} />
                <Field label={t("common.last")} value={<Timestamp value={node.lastSeen} />} />
                {node.lastAdvertAt != null && <Field label="Advert" value={<Timestamp value={node.lastAdvertAt} />} />}
                {node.clockDriftSeconds != null && (
                  <Field
                    label={t("details.clockDrift")}
                    value={<span className={node.clockOutOfSync ? "text-warn" : "text-green"}>{formatClockDrift(node.clockDriftSeconds, {
                      inSync: t("details.clockInSync"),
                      ahead: t("details.clockAhead"),
                      behind: t("details.clockBehind"),
                    })}</span>}
                  />
                )}
              </div>
            </Section>

            <Section title={node.knownNeighborCount > 0 ? t("nodes.neighborsCount", { count: node.knownNeighborCount }) : t("nodes.neighbors")}>
              {neighbors && neighbors.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {neighbors.map((n) => (
                    // the endpoint returns one row per (neighbor, iata), so the node id alone repeats
                    <NodeNeighborRow
                      key={`${n.id}-${n.iata}`}
                      neighbor={n}
                      onClick={onViewNode ? () => onViewNode(n.id) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="font-mono text-[13px] text-text-dim">{t("nodes.noKnownNeighbors")}</div>
              )}
            </Section>

            <Section title={t("details.observations")}>
              {observations && observations.items.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {observations.items.map((obs) => (
                    <NodeObservationRow
                      key={obs.id}
                      obs={obs}
                      onClick={onAnalyzePacket ? () => onAnalyzePacket(obs.packetHash) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="font-mono text-[13px] text-text-dim">{t("nodes.noRecentObservations")}</div>
              )}
            </Section>
        </>
      )}
    </DetailPanel>
  );
}
