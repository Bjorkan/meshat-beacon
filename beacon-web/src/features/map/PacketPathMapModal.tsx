import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { Observation, PacketDetail } from '../../types/api';
import { nodeQueries } from '../../api/queries';
import { ModalOverlay } from '../../components/ModalOverlay';
import { CloseButton } from '../../components/CloseButton';
import { CopyLinkButton } from '../../components/CopyLinkButton';
import { formatPropagation } from '../../lib/formatters';
import { useTheme } from '../../hooks/useTheme';
import { buildPacketPathResult } from './packet-path';
import { PacketPathMap } from './PacketPathMap';
import { mapStyleForTheme } from './types';
import { PathData } from '../packets/PathData';

// Closable mini-map of a packet's resolved path(s). "All paths" overlays every observation's route;
// clicking an observer isolates its path. Lives over the analyzer (no tab switch), so closing it
// returns the user exactly where they were.
function Row({
  active,
  color,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  color?: string;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] font-mono border-l-2 transition-colors ${
        active
          ? 'border-l-secondary bg-secondary/5 text-text-bright'
          : 'border-l-transparent text-text-normal hover:bg-text-normal/3'
      }`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="truncate">{label}</span>
      {meta != null && <span className="ml-auto text-text-dim">{meta}</span>}
    </button>
  );
}

// Unverifiable observation row: the observer that heard the packet plus its raw path
// hashes as hop blocks (gray — no verification claim). Zero-hop sightings (DIRECT,
// hopCount 0) render a single Direkt row instead of an empty list.
function ObserverPathRow({
  observation,
  active,
  onClick,
}: {
  observation: Observation;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const hashSize = observation.pathLength.hashSize;
  const chars = hashSize * 2;
  const hops =
    observation.pathBytes && chars > 0
      ? (observation.pathBytes.match(new RegExp(`.{1,${chars}}`, 'g')) ?? [])
      : [];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`w-full flex flex-col gap-1.5 px-3 py-2 text-left font-mono border-l-2 transition-colors ${
        active
          ? 'border-l-secondary bg-secondary/5 text-text-bright'
          : 'border-l-transparent text-text-normal hover:bg-text-normal/3'
      }`}
    >
      <span className="flex w-full items-center gap-2 text-[13px]">
        <span className="truncate">
          {observation.observerName ?? observation.observerId.slice(0, 8)}
        </span>
        <span className="ml-auto shrink-0 text-text-dim">
          {formatPropagation(observation.propagationTimeMs)}
        </span>
      </span>
      {hops.length > 0 ? (
        <span
          className="flex flex-wrap items-center gap-1 text-[11px]"
          aria-label={t('map.unverifiedPathHashes')}
        >
          <PathData
            pathBytes={observation.pathBytes!}
            hashSize={hashSize}
            resolvedPath={observation.resolvedPath}
            size="sm"
          />
        </span>
      ) : (
        <span className="text-[11px] text-text-dim">{t('map.directHop')}</span>
      )}
    </button>
  );
}

export function PacketPathMapModal({
  detail,
  onClose,
  initialSelectedKey,
}: {
  detail: PacketDetail;
  onClose: () => void;
  initialSelectedKey?: string | null;
}) {
  const { t } = useTranslation();
  // Global 2-byte collision set: a 2-byte route draws only when none of its air
  // prefixes collide anywhere in the database. Fail-closed while loading — an
  // unresolved fetch withholds 2-byte routes rather than drawing them blind.
  const { data: ambiguousPrefix2 } = useQuery(nodeQueries.ambiguousPrefix2());
  const { paths, blocked } = useMemo(
    () => buildPacketPathResult(detail, { ambiguousPrefix2 }),
    [detail, ambiguousPrefix2],
  );
  const blockedKey =
    blocked == null
      ? null
      : blocked.reason === 'short-hash'
        ? 'map.pathBlockedShortHash'
        : blocked.reason === 'ambiguous-hop'
          ? 'map.pathBlockedAmbiguousHop'
          : blocked.reason === 'out-of-range'
            ? 'map.pathBlockedOutOfRange'
            : 'map.pathBlockedUnresolved';
  const blockedMessage =
    blocked == null || blockedKey == null
      ? null
      : t(blockedKey, {
          size: blocked.observedHashSize,
          required: 2,
          count: blocked.count,
        });
  const [selectedKey, setSelectedKey] = useState<string | null>(
    // deep-link value that matches a known path isolates it; anything else (incl. "all") shows All
    () =>
      initialSelectedKey && paths.some((p) => p.key === initialSelectedKey)
        ? initialSelectedKey
        : null,
  );
  const { themeId } = useTheme();
  const styleId = useMemo(() => mapStyleForTheme(themeId), [themeId]);

  // Lacking a verified route the map still renders — same chrome (map + observer list),
  // but with no lines/points, the basemap blurred, and the explanation floating over it.
  // The observer list then shows each observation's raw path hashes instead of path rows.
  const hasDrawableRoute = paths.length > 0;

  return (
    <ModalOverlay label={t('map.packetPathLabel')} onClose={onClose}>
      <div className="h-full lg:w-[860px] w-full lg:max-w-[92vw] bg-bg-surface flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0">
          <span className="text-[13px] font-mono font-medium text-text-dim uppercase tracking-wider">
            {t('map.packetPath')}
          </span>
          <div className="flex items-center gap-1.5">
            <CopyLinkButton
              to="/packets"
              params={() => ({
                hash: detail.packetHash,
                path: selectedKey ?? 'all',
                analyze: null,
              })}
              ariaLabel={t('map.copyPathLink')}
            />
            <CloseButton onClose={onClose} label={t('map.closePath')} className="-mr-1" />
          </div>
        </div>

        {hasDrawableRoute && blockedMessage != null && (
          <div
            role="note"
            className="shrink-0 px-3 py-2 border-b border-warn/20 bg-warn/5 text-[12px] font-mono text-text-normal"
          >
            {blockedMessage}
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <div className="relative h-[55vh] max-lg:shrink-0 lg:h-auto lg:flex-1 min-h-0 bg-bg-base">
            <PacketPathMap paths={paths} selectedKey={selectedKey} styleId={styleId} />
            {!hasDrawableRoute && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center bg-bg-base/40 p-6 backdrop-blur-[3px]"
                role="note"
                aria-label={t('map.noDrawablePaths')}
              >
                <div className="max-w-md space-y-2 text-center font-mono text-sm">
                  <h2 className="font-semibold text-text-bright">{t('map.noDrawablePaths')}</h2>
                  <p className="text-text-normal">
                    {blockedMessage ?? t('map.noDrawablePathsHint')}
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="lg:w-[220px] lg:border-l border-t lg:border-t-0 border-border flex flex-col min-h-0 overflow-y-auto">
            <div className="sticky top-0 bg-bg-surface z-10 border-b border-border-subtle">
              <Row
                active={selectedKey === null}
                label={t('map.allPaths')}
                onClick={() => setSelectedKey(null)}
              />
            </div>
            {hasDrawableRoute
              ? paths.map((p) => (
                  <Row
                    key={p.key}
                    active={selectedKey === p.key}
                    color={p.color}
                    label={p.key === 'trace' ? t('map.traceRoute') : p.label}
                    meta={formatPropagation(p.propagationMs)}
                    onClick={() => setSelectedKey(p.key)}
                  />
                ))
              : detail.observations.map((obs) => (
                  <ObserverPathRow
                    key={obs.observerId}
                    observation={obs}
                    active={selectedKey === obs.observerId}
                    onClick={() =>
                      setSelectedKey((cur) => (cur === obs.observerId ? null : obs.observerId))
                    }
                  />
                ))}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
