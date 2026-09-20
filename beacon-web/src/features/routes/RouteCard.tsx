import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlannedRoute, PlannedRouteLeg, PlannedRouteNode } from '../../types/api';
import { Timestamp } from '../../components/Timestamp';
import { formatSnr } from '../../lib/formatters';
import { CopyButton } from '../../components/CopyButton';
import { exportMeshcoreRoute } from './route-features';

function LegIcon({ kind }: { kind: 'signal' | 'samples' | 'neighbor' | 'warning' }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
    >
      {kind === 'signal' && <path d="M4 20v-4m5 4v-8m5 8V8m5 12V4" />}
      {kind === 'samples' && <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h4" />}
      {kind === 'neighbor' && (
        <>
          <circle cx="5" cy="12" r="3" />
          <circle cx="19" cy="12" r="3" />
          <path d="M8 12h8m-3-3 3 3-3 3" />
        </>
      )}
      {kind === 'warning' && (
        <>
          <path d="m12 3 10 18H2L12 3Zm0 5v5" />
          <path d="M12 17h.01" />
        </>
      )}
    </svg>
  );
}

export function LegRow({ leg }: { leg: PlannedRouteLeg }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 border-y border-border-subtle py-3 text-xs leading-relaxed text-text-muted">
      <div className="flex items-start gap-2.5">
        <LegIcon kind="signal" />
        <div className="min-w-0">
          <p className="mb-0.5 text-[11px]">{t('routes.signalSnr')}</p>
          <p className="text-sm font-medium tabular-nums text-text-bright">
            {leg.unmeasured
              ? t('routes.unmeasuredLeg')
              : leg.snr != null
                ? `${formatSnr(leg.snr)} dB`
                : t('routes.legNoSnr')}
          </p>
          {leg.unmeasured && leg.snr != null && (
            <p className="mt-1">{t('routes.lastKnownSnr', { snr: formatSnr(leg.snr) })}</p>
          )}
        </div>
      </div>
      {leg.snrSampleCount > 0 && leg.snrLastSeen > 0 && (
        <div className="flex items-start gap-2.5">
          <LegIcon kind="samples" />
          <div className="min-w-0">
            <p>{t('routes.snrSamples', { count: leg.snrSampleCount })}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-1">
              <span>{t('routes.lastSample')}</span>
              <Timestamp value={leg.snrLastSeen} static />
            </p>
          </div>
        </div>
      )}
      {leg.unseen && (
        <p className="flex items-start gap-2.5 text-warn">
          <LegIcon kind="warning" />
          <span>{t('routes.unseenLeg')}</span>
        </p>
      )}
      {leg.neighbor && (
        <p className="flex items-start gap-2.5">
          <LegIcon kind="neighbor" />
          <span>{t('routes.neighborDirection')}</span>
        </p>
      )}
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
      className={`w-full cursor-pointer border-b border-border-subtle border-l-[3px] px-5 py-4 text-left transition-colors ${
        active
          ? 'border-l-primary bg-primary/5'
          : 'border-l-transparent bg-bg-base hover:bg-bg-surface'
      }`}
    >
      <button
        type="button"
        aria-label={t('routes.selectRoute', { label })}
        aria-pressed={active}
        onClick={onSelect}
        className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded text-left text-sm focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span id={titleId} className="text-base font-semibold text-text-bright">
          {label}
        </span>
        <span className="ml-auto text-lg font-semibold tabular-nums text-text-bright">
          {t('routes.hops', { count: route.hopCount })}
        </span>
        {active && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {t('routes.selected')}
          </span>
        )}
      </button>
      {!expanded && (
        <p className="mt-1 break-words text-sm leading-relaxed text-text-muted">
          {via.length > 0 ? t('routes.via', { nodes: viaSummary }) : t('routes.directRoute')}
        </p>
      )}
      <div className="mt-2 space-y-1 text-xs leading-relaxed text-text-muted">
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
            <ol className="mt-4 border-t border-border-subtle pt-4">
              {route.nodes.map((node, i) => (
                <li key={`${node.publicKey}-${i}`} className="relative pl-8">
                  {i < route.nodes.length - 1 && (
                    <span
                      aria-hidden
                      className="absolute -bottom-6 left-[7px] top-6 w-0.5 bg-primary/50"
                    />
                  )}
                  <span
                    aria-hidden
                    className={`absolute left-0 top-4 h-4 w-4 rounded-full border-2 border-primary ${i === route.nodes.length - 1 ? 'bg-primary' : 'bg-bg-base'}`}
                  />
                  <button
                    type="button"
                    aria-label={t('routes.openNode', { name: nodeName(node) })}
                    className="flex min-h-12 w-full flex-col items-start justify-center gap-0.5 rounded py-2 text-left text-sm text-text-bright hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => onOpenNode(node.id)}
                  >
                    <span className="w-full break-words font-semibold">{nodeName(node)}</span>
                    {node.name && (
                      <span className="font-mono text-[11px] font-normal tracking-wide text-text-muted">
                        {node.publicKey.slice(0, 6).toUpperCase()}
                      </span>
                    )}
                  </button>
                  {node.stale && <p className="pb-1 text-xs text-warn">{t('routes.staleNode')}</p>}
                  {route.legs[i] && (
                    <div className="pb-4 pt-2">
                      <LegRow leg={route.legs[i]} />
                    </div>
                  )}
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
          className="min-h-11 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t(expanded ? 'routes.hideDetails' : 'routes.showDetails')}
        </button>
        {meshcoreRoute != null && (
          <CopyButton
            value={meshcoreRoute}
            label={t('routes.copyMeshcoreRoute')}
            copiedLabel={t('routes.meshcoreRouteCopied')}
            ariaLabel={t('routes.copyMeshcoreRoute')}
            className="min-h-11 max-w-full scroll-my-2 rounded-full! px-3! font-sans! text-xs! tracking-normal! normal-case! focus-visible:outline-2 focus-visible:outline-primary"
          />
        )}
      </div>
      {meshcoreTooLong && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-warn">
          {t('routes.meshcoreTooLong')}
        </p>
      )}
      {expanded && meshcoreRoute != null && multibyteUnconfirmed && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-warn">
          {t('routes.multibyteUnconfirmed')}
        </p>
      )}
    </article>
  );
}
