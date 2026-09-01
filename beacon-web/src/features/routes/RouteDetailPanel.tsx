import { DetailPanel, Section, Field } from "../../components/DetailPanel";
import { useTranslation } from "react-i18next";
import { Badge } from "../../components/Badge";
import { Timestamp } from "../../components/Timestamp";
import { ResolvedHopBlock } from "../packets/PathData";
import type { KnownRoute, ResolvedHop } from "../../types/api";

// Detail for a selected known route. The /routes list already carries the full hops, so this takes the
// route object directly — no extra fetch. Hops reuse the packet path renderer's block (high-confidence
// by definition); the node label lights up if/when the server populates hop.node.
interface RouteDetailPanelProps {
  route: KnownRoute;
  onClose: () => void;
}

export function RouteDetailPanel({ route, onClose }: RouteDetailPanelProps) {
  const { t } = useTranslation();
  return (
    <DetailPanel title={t("routes.detail")} onClose={onClose}>
      <Section title={t("details.summary")} first>
        <div className="flex items-center gap-3 font-mono text-[13px]">
          <Badge variant="default">{route.iata}</Badge>
          <Field label={t("packets.hops")} value={route.hopCount} />
          <Field label={t("details.observations")} value={route.observationCount.toLocaleString()} />
        </div>
      </Section>

      <Section title={t("routes.route")}>
        <div className="flex flex-col gap-1.5">
          {route.hops.map((hop, i) => {
            const resolved: ResolvedHop = { confidence: "high", nodes: hop.node ? [hop.node] : [] };
            return (
              <div key={i} className="flex items-center gap-2 font-mono text-[13px]">
                <span className="text-text-dim w-6 shrink-0">#{i + 1}</span>
                <ResolvedHopBlock hop={resolved} label={hop.hashBytes.toUpperCase()} />
                {hop.node?.name && <span className="text-text-muted truncate">{hop.node.name}</span>}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={t("details.timestamps")}>
        <div className="flex flex-col gap-0.5 font-mono text-[13px]">
          <Field label={t("routes.firstSeen")} value={<Timestamp value={route.firstSeen} />} />
          <Field label={t("routes.lastSeen")} value={<Timestamp value={route.lastSeen} />} />
        </div>
      </Section>
    </DetailPanel>
  );
}
