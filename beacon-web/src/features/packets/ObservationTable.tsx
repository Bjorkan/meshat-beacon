import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { Observation } from "../../types/api";
import { formatSnr, formatPropagation, snrLevel, SIGNAL_LEVEL_CLASSES } from "../../lib/formatters";
import { DataTable, type Column } from "../../components/DataTable";
import { Timestamp } from "../../components/Timestamp";
import { PathData } from "./PathData";

interface Props {
  observations: Observation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function observationColumns(t: TFunction): Column<Observation>[] {
  return [
    {
      header: "Observer",
      label: t("entities.observer"),
      size: 19,
      cell: (observation) => observation.observerName ?? observation.observerId.slice(0, 8),
    },
    {
      header: "IATA",
      size: 8,
      className: "font-mono font-bold text-primary tracking-wider",
      cell: (observation) => observation.iata,
    },
    {
      header: "Heard",
      label: t("packets.heard"),
      size: 14,
      className: "text-text-muted",
      cell: (observation) => <Timestamp value={observation.heardAt} />,
    },
    {
      header: "SNR",
      size: 8,
      className: (observation) => {
        const level = snrLevel(observation.snr);
        return `font-mono ${level ? SIGNAL_LEVEL_CLASSES[level] : "text-text-dim"}`;
      },
      cell: (observation) => formatSnr(observation.snr),
    },
    {
      header: "RSSI",
      size: 8,
      className: "font-mono text-text-muted",
      cell: (observation) => observation.rssi ?? "—",
    },
    {
      header: "Prop",
      size: 10,
      className: "font-mono text-text-muted",
      cell: (observation) => formatPropagation(observation.propagationTimeMs),
    },
    {
      header: "Hops",
      label: t("packets.hops"),
      size: 8,
      className: "font-mono text-text-muted",
      cell: (observation) => observation.pathLength.hopCount,
    },
    {
      header: "Path",
      label: t("fields.path"),
      cell: (observation) => observation.pathBytes ? (
        <PathData
          pathBytes={observation.pathBytes}
          hashSize={observation.pathLength.hashSize}
          resolvedPath={observation.resolvedPath}
          size="sm"
        />
      ) : (
        <span className="text-text-dim">—</span>
      ),
    },
  ];
}

// The compact observation list now uses the same TanStack row/column pipeline as every other table.
export function ObservationTable({ observations, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const columns = useMemo(() => observationColumns(t), [t]);

  return (
    <DataTable
      columns={columns}
      rows={observations}
      rowKey={(observation) => String(observation.id)}
      selectedKey={selectedId == null ? null : String(selectedId)}
      onSelect={(key) => { if (key !== null) onSelect(Number(key)); }}
      emptyLabel={t("common.noData")}
    />
  );
}
