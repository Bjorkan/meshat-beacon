import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CloseButton } from "../../components/CloseButton";
import { CopyLinkButton } from "../../components/CopyLinkButton";
import type { PacketDetail } from "../../types/api";
import { PayloadType, PAYLOAD_TYPE_NAMES, ROUTE_TYPE_NAMES, type PayloadTypeValue, type RouteTypeValue } from "../../types/enums";
import { Badge } from "../../components/Badge";
import { Tooltip } from "../../components/Tooltip";
import { payloadTypeVariant } from "../../components/badge-utils";
import { ScopeTag } from "../../components/ScopeTag";
import { formatHex, formatPropagation } from "../../lib/formatters";
import { Timestamp } from "../../components/Timestamp";
import { buildObservationFrame, computeFieldRanges, ColoredHexDump, HeaderBitBreakdown, PathLengthBitBreakdown, ColorAccentField, DrawerSection, ObservationDetail } from "./packet-structure";
import { PayloadBreakdown } from "./payload-renderers";
import { ObservationCard } from "./ObservationCard";
import { PathData } from "./PathData";
import { buildPacketPaths } from "../map/packet-path";

function decodePayloadHex(encoded: string): string | null {
  try {
    const inner = JSON.parse(atob(encoded));
    if (typeof inner !== "string") return null;
    const raw = atob(inner);
    return Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

interface PacketAnalyzerDrawerProps {
  detail: PacketDetail | undefined;
  selectedObservationId: number | null;
  onClose: () => void;
  onSelectObservation?: (id: number) => void;
  onViewNode?: (nodeId: string) => void;
  onViewPath?: () => void;
  loading?: boolean;
}

// side panel (full-screen on mobile) showing packet structure and payload breakdown

export function PacketAnalyzerDrawer({ detail, selectedObservationId, onClose, onSelectObservation, onViewNode, onViewPath, loading }: PacketAnalyzerDrawerProps) {
  const { t } = useTranslation();

  const hasPath = useMemo(() => (detail ? buildPacketPaths(detail).length > 0 : false), [detail]);

  const selectedObs = detail?.observations.find((o) => o.id === selectedObservationId)
    ?? detail?.observations[0]
    ?? null;

  const rawHex = detail ? buildObservationFrame(detail, selectedObs) : "";
  const totalBytes = rawHex.length / 2;

  const fieldRanges = detail
    ? computeFieldRanges(detail, selectedObs, totalBytes)
    : {};

  const headerHex = rawHex.slice(0, 2);

  return (
    <div data-testid="packet-analyzer-drawer" className="absolute inset-0 z-30 w-full lg:static lg:inset-auto lg:z-auto lg:shrink-0 lg:w-[400px] lg:border-l border-border bg-bg-surface flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0">
        <span className="text-[13px] font-mono font-medium text-text-dim uppercase tracking-wider">{t("packets.analyzer")}</span>
        <div className="flex items-center gap-1.5">
          {detail && <CopyLinkButton to="/packets" params={{ hash: detail.packetHash, analyze: "1" }} ariaLabel={t("packets.copyLink")} />}
          <CloseButton onClose={onClose} label={t("packets.closeAnalyzer")} className="-mr-1" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {!detail ? (
          <div className="flex flex-col items-center justify-center h-full gap-2.5 text-text-dim">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-border">
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
              <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.2" />
              <line x1="8" y1="9" x2="8" y2="19" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span className="text-[13px] font-mono">{loading ? t("common.loading") : t("packets.selectToAnalyze")}</span>
          </div>
        ) : (
          <>
            <DrawerSection title={t("details.summary")} first>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs font-semibold text-primary tracking-wider">
                  {formatHex(detail.packetHash)}
                </span>
                <Badge variant={payloadTypeVariant(detail.header.payloadType)}>
                  {PAYLOAD_TYPE_NAMES[detail.header.payloadType as PayloadTypeValue] ?? t("packets.unknown")}
                </Badge>
                {detail.scope && <ScopeTag>{detail.scope}</ScopeTag>}
                <Tooltip
                  label={t("packets.heardBy", { count: detail.observations.length })}
                  className="ml-auto"
                >
                  <span
                    className="font-mono text-[13px] text-primary font-semibold bg-primary/6 px-1.5 rounded-sm"
                    aria-label={t("packets.heardBy", { count: detail.observations.length })}
                  >
                    ×{detail.observations.length}
                  </span>
                </Tooltip>
              </div>
              <div className="flex items-center gap-3 text-[13px] font-mono">
                <span><span className="text-text-dim">{t("common.first")} </span><Timestamp value={detail.firstHeardAt} className="text-text-normal" /></span>
                <span className="text-[6px] text-border" aria-hidden>·</span>
                <span><span className="text-text-dim">{t("common.last")} </span><Timestamp value={detail.lastHeardAt} className="text-text-normal" /></span>
                <span className="text-[6px] text-border" aria-hidden>·</span>
                <span><span className="text-text-dim">{t("packets.propagation")} </span><span className="text-text-normal">{formatPropagation(detail.firstToLastMs)}</span></span>
              </div>
            </DrawerSection>

            <div className="px-3 py-2 border-b border-border-subtle">
              <button
                type="button"
                onClick={onViewPath}
                disabled={!hasPath || !onViewPath}
                title={hasPath ? undefined : t("packets.noResolvedPath")}
                className="w-full flex items-center justify-center gap-1.5 rounded border border-border bg-bg-base px-3 py-1.5 text-[13px] font-mono text-text-normal hover:bg-text-normal/3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M9 5l-6 2v12l6-2 6 2 6-2V5l-6 2-6-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M9 5v12M15 7v12" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                {t("packets.viewPath")}
              </button>
            </div>

            {selectedObs && (
              <DrawerSection title={t("packets.observation")}>
                <ObservationDetail observation={selectedObs} />
              </DrawerSection>
            )}

            {detail.observations.length >= 1 && (
              <DrawerSection title={t("packets.observationsCount", { count: detail.observations.length })} collapsible defaultOpen={false}>
                <div className="flex flex-col gap-1">
                  {detail.observations.map((obs) => (
                    <ObservationCard
                      key={obs.id}
                      observation={obs}
                      selected={selectedObs?.id === obs.id}
                      onClick={onSelectObservation ? () => onSelectObservation(obs.id) : undefined}
                      onViewNode={onViewNode}
                      isTrace={detail.header.payloadType === PayloadType.TRACE}
                    />
                  ))}
                </div>
              </DrawerSection>
            )}

            {rawHex && (
              <DrawerSection title={t("packets.rawPacket")}>
                <div className="bg-bg-base border border-border rounded p-2 max-h-40 overflow-y-auto">
                  <ColoredHexDump data={rawHex} ranges={fieldRanges} />
                </div>
              </DrawerSection>
            )}

            <DrawerSection title={t("packets.structure")}>
              <div className="flex flex-col gap-2.5 font-mono text-[13px]">
                {/* Header byte */}
                <ColorAccentField field="header">
                  <div className="text-text-dim text-xs font-medium uppercase tracking-wider mb-1">{t("packets.headerByte")}</div>
                  <div className="flex gap-x-4">
                    <span><span className="text-text-dim">Ver </span><span className="text-text-normal">{detail.header.payloadVersion}</span></span>
                    <span><span className="text-text-dim">Type </span><span className="text-text-normal">{PAYLOAD_TYPE_NAMES[detail.header.payloadType as PayloadTypeValue] ?? "?"} ({detail.header.payloadType})</span></span>
                    <span><span className="text-text-dim">Route </span><span className="text-text-normal">{ROUTE_TYPE_NAMES[detail.header.routeType as RouteTypeValue] ?? "?"} ({detail.header.routeType})</span></span>
                  </div>
                  {headerHex && (
                    <HeaderBitBreakdown headerHex={headerHex} />
                  )}
                </ColorAccentField>

                {/* Transport codes */}
                {detail.transportCodes && (
                  <ColorAccentField field="transport">
                    <span className="text-text-dim">Transport </span>
                    <span className="text-text-normal">{detail.transportCodes.regionCode} / {detail.transportCodes.subRegionCode}</span>
                  </ColorAccentField>
                )}

                {/* Path length */}
                {selectedObs && (
                  <ColorAccentField field="pathLength">
                    <div className="text-text-dim text-xs font-medium uppercase tracking-wider mb-1">{t("packets.pathLength")}</div>
                    <div className="flex gap-x-4">
                      <span><span className="text-text-dim">{t("packets.hashSize")} </span><span className="text-text-normal">{selectedObs.pathLength.hashSize}B</span></span>
                      <span><span className="text-text-dim">{t("packets.hops")} </span><span className="text-text-normal">{selectedObs.pathLength.hopCount}</span></span>
                    </div>
                    <PathLengthBitBreakdown pathLengthByte={parseInt(selectedObs.pathLength.raw, 16)} />
                  </ColorAccentField>
                )}

                {/* Path data — TRACE's pathBytes are now its trace path hashes (matching hashSize/hopCount
                    and resolvedPath), so it resolves through PathData like every other type. */}
                {selectedObs?.pathBytes && (
                  <ColorAccentField field="pathData">
                    <div className="text-text-dim text-xs font-medium uppercase tracking-wider mb-1">{t("packets.pathData")}</div>
                    <PathData pathBytes={selectedObs.pathBytes} hashSize={selectedObs.pathLength.hashSize} resolvedPath={selectedObs.resolvedPath} onViewNode={onViewNode} />
                  </ColorAccentField>
                )}

                {detail.originPubkey && detail.header.payloadType !== PayloadType.ADVERT && (
                  <ColorAccentField field="payload">
                    <span className="text-text-dim text-xs font-medium uppercase tracking-wider">{t("packets.originPublicKey")}</span>
                    <div className="text-text-normal break-all text-[13px]">{detail.originPubkey}</div>
                  </ColorAccentField>
                )}
              </div>
            </DrawerSection>

            {detail.parsedPayload && typeof detail.parsedPayload === "object" && Object.keys(detail.parsedPayload).length > 0 && (
              <DrawerSection title={t("packets.payloadBreakdown")}>
                <div className="font-mono text-[13px]">
                  <PayloadBreakdown payload={detail.parsedPayload} resolvedRoute={detail.resolvedRoute} resolvedSource={selectedObs?.resolvedSource} resolvedDestination={selectedObs?.resolvedDestination} onViewNode={onViewNode} />
                </div>
              </DrawerSection>
            )}

            {detail.parsedPayload && typeof detail.parsedPayload === "string" && (() => {
              const hex = decodePayloadHex(detail.parsedPayload);
              if (!hex) return null;
              return (
                <DrawerSection title={t("packets.payloadData")}>
                  <div className="bg-bg-base border border-border rounded p-2 max-h-40 overflow-y-auto">
                    <pre className="text-[13px] font-mono text-text-muted leading-relaxed whitespace-pre-wrap">
                      {(hex.match(/.{1,2}/g) ?? []).reduce((acc, b, i) => {
                        const sep = i > 0 ? " " : "";
                        return acc + sep + b.toUpperCase();
                      }, "")}
                    </pre>
                  </div>
                  <div className="text-[11px] text-text-dim mt-1">{hex.length / 2} bytes</div>
                </DrawerSection>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
