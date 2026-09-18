import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlannedRoute, PlannedRouteLeg, PlannedRouteNode } from '../../types/api';
import { Timestamp } from '../../components/Timestamp';
import { formatSnr } from '../../lib/formatters';
import { CopyButton } from '../../components/CopyButton';
import { exportMeshcoreRoute } from './route-features';

export function LegRow({ leg }: { leg: PlannedRouteLeg }) {
  const { t } = useTranslation();
  return (
    <div className="ml-2 space-y-1 border-l border-border py-2 pl-4 text-xs text-text-muted">
      <p className="tabular-nums">
        {leg.unmeasured
          ? t('routes.unmeasuredLeg')
          : leg.snr != null
            ? `${formatSnr(leg.snr)} dB`
            : t('routes.legNoSnr')}
      </p>
      {leg.unmeasured && leg.snr != null && (
        <p>{t('routes.lastKnownSnr', { snr: formatSnr(leg.snr) })}</p>
      )}
      {leg.snrSampleCount > 0 && leg.snrLastSeen > 0 && (
        <p>
          {t('routes.snrSamples', { count: leg.snrSampleCount })}
          {' · '}
          <Timestamp value={leg.snrLastSeen} static />
        </p>
      )}
      {leg.unseen && <p className="text-warn">{t('routes.unseenLeg')}</p>}
      {leg.neighbor && <p>{t('routes.neighborDirection')}</p>}
    </div>
  );
}

export function RouteCard({
  route,
  index,
  active,
  onSelect,
  onOpenNode,
}: {
  route: PlannedRoute;
  index: number;
  active: boolean;
  onSelect: () => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const titleId = useId();
  const via = route.nodes.slice(1, -1);
  const measuredCount = route.legs.filter((leg) => !leg.unmeasured && leg.snr != null).length;
  const unseenCount = route.legs.filter((leg) => leg.unseen).length;
  const staleCount = route.nodes.filter((node) => node.stale).length;
  const nodeName = (node: PlannedRouteNode) =>
    node.name ?? node.publicKey.slice(0, 6).toUpperCase();
  const viaNames = via.map(nodeName);
  const viaSummary =
    via.length > 3
      ? [
          viaNames[0],
          t('routes.moreNodes', { count: via.length - 2 }),
          viaNames[via.length - 1],
        ].join(' → ')
      : viaNames.join(' → ');
  const meshcoreExport = exportMeshcoreRoute(route);
  const meshcoreRoute = meshcoreExport.ok ? meshcoreExport.value : null;
  const meshcoreTooLong = !meshcoreExport.ok && meshcoreExport.reason === 'too-long';
  const multibyteUnconfirmed = route.nodes.some((n) => n.supportsMultibytePaths !== true);
  const label = index === 0 ? t('routes.best') : t('routes.alternative', { n: index });
  return (
    <article
      aria-labelledby={titleId}
      onClick={(e) => {
        if (!(e.target instanceof Element) || e.target.closest('button, a, [data-route-details]'))
          return;
        if (!active) onSelect();
      }}
      className={`w-full cursor-pointer rounded-lg border p-3 text-left shadow-lg transition-colors ${
        active ? 'border-primary-dim bg-bg-base' : 'border-border bg-bg-base hover:border-text-dim'
      }`}
    >
      <button
        type="button"
        aria-label={t('routes.selectRoute', { label })}
        aria-pressed={active}
        onClick={onSelect}
        className="flex min-h-9 w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span id={titleId} className="font-mono text-[13px] font-semibold text-text-bright">
          {label}
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {t('routes.hops', { count: route.hopCount })}
        </span>
        {active && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-primary">
            {t('routes.selected')}
          </span>
        )}
      </button>
      {!expanded && (
        <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-text-muted">
          {via.length > 0 ? t('routes.via', { nodes: viaSummary }) : t('routes.directRoute')}
        </p>
      )}
      <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-text-muted">
        <p>{t('routes.snrCoverage', { measured: measuredCount, total: route.legs.length })}</p>
        {unseenCount > 0 && (
          <p className="text-warn">{t('routes.unseenHops', { count: unseenCount })}</p>
        )}
        {staleCount > 0 && (
          <p className="text-warn">{t('routes.staleNodes', { count: staleCount })}</p>
        )}
      </div>
      <div id={detailsId} hidden={!expanded} data-route-details className="cursor-auto">
        {expanded && (
          <>
            <ol className="mt-3 border-t border-border-subtle pt-2">
              {route.nodes.map((node, i) => (
                <li key={`${node.publicKey}-${i}`}>
                  <button
                    type="button"
                    aria-label={t('routes.openNode', { name: nodeName(node) })}
                    className="min-h-9 w-full rounded py-1 text-left text-[13px] hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => onOpenNode(node.id)}
                  >
                    <span className="break-words font-semibold">{nodeName(node)}</span>
                    {node.name && (
                      <span className="ml-2 inline-block font-mono text-[11px] text-text-muted">
                        {node.publicKey.slice(0, 6).toUpperCase()}
                      </span>
                    )}
                  </button>
                  {node.stale && <p className="pb-1 text-xs text-warn">{t('routes.staleNode')}</p>}
                  {route.legs[i] && <LegRow leg={route.legs[i]} />}
                </li>
              ))}
            </ol>
            {meshcoreRoute != null && (
              <div className="mt-2 border-t border-border-subtle pt-2 text-xs text-text-muted">
                <p>{t('routes.meshcoreFormat')}</p>
                <code className="mt-1 block select-text break-all">{meshcoreRoute}</code>
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((shown) => !shown)}
          className="min-h-9 rounded text-xs text-text-muted underline underline-offset-4 hover:text-text-normal focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t(expanded ? 'routes.hideDetails' : 'routes.showDetails')}
        </button>
        {meshcoreRoute != null && (
          <CopyButton
            value={meshcoreRoute}
            label={t('routes.copyMeshcoreRoute')}
            copiedLabel={t('routes.meshcoreRouteCopied')}
            ariaLabel={t('routes.copyMeshcoreRoute')}
            className="min-h-9 max-w-full focus-visible:outline-2 focus-visible:outline-primary"
          />
        )}
      </div>
      {meshcoreTooLong && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-warn">
          {t('routes.meshcoreTooLong')}
        </p>
      )}
      {meshcoreRoute != null && multibyteUnconfirmed && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-warn">
          {t('routes.multibyteUnconfirmed')}
        </p>
      )}
    </article>
  );
}
