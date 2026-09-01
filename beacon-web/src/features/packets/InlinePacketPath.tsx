import type { PacketSummary } from "../../types/api";
import { buildPathSummary } from "./path-summary";

const CHIP_CLASSES = {
  high: "bg-green/8 text-green",
  ambiguous: "bg-warn/8 text-warn",
  none: "bg-text-muted/8 text-text-dim",
} as const;

function rawPathLabel(packet: PacketSummary): string | undefined {
  const observer = packet.latestObserver;
  const raw = observer?.pathBytes;
  const hashSize = observer?.pathLength?.hashSize;
  const hopCount = observer?.pathLength?.hopCount;
  if (!raw || !hashSize || !hopCount || hashSize < 1) return raw?.toUpperCase();
  const width = hashSize * 2;
  if (raw.length !== width * hopCount) return raw.toUpperCase();
  const hops: string[] = [];
  for (let i = 0; i < raw.length; i += width) hops.push(raw.slice(i, i + width).toUpperCase());
  return hops.join(" → ");
}

export function InlinePacketPath({ packet }: { packet: PacketSummary }) {
  const summary = buildPathSummary(packet);
  if (summary.isNa) return <span className="text-text-dim">n/a</span>;
  if (summary.chips.length === 0) {
    return <span className="font-mono text-text-muted">{summary.hopLabel.replace(" hops", "h")}</span>;
  }

  const rawPath = rawPathLabel(packet);
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap font-mono" title={rawPath}>
      {summary.chips.map((chip, index) => {
        const title = chip.kind === "node"
          ? `${chip.label} · ${chip.raw}`
          : chip.confidence === "ambiguous"
            ? `${chip.label} · ambiguous (${chip.candidateCount ?? 0} matches)`
            : chip.label;
        return (
          <span key={`${index}-${chip.kind}-${chip.label}`} className="contents">
            {index > 0 && <span className="shrink-0 text-text-dim" aria-hidden>→</span>}
            <span
              className={`max-w-28 shrink truncate rounded-sm px-1 py-px font-semibold ${CHIP_CLASSES[chip.confidence]}`}
              title={title}
            >
              {chip.label}
            </span>
          </span>
        );
      })}
      {summary.overflow > 0 && <span className="shrink-0 text-text-dim">+{summary.overflow}</span>}
    </span>
  );
}
