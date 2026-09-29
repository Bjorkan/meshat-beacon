import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SegmentedControl } from './SegmentedControl';
import { NODE_TYPE_FILTER_OPTIONS, type NeighborLinesMode } from './types';
import { CopyLinkButton } from '../../components/CopyLinkButton';
import { MeshCoreRegionPicker } from '../../components/MeshCoreRegionPicker';
import { meshcoreRegionQueries } from '../../api/queries';

interface MapSettingsPanelProps {
  typeFilter: string;
  onTypeChange: (t: string) => void;
  clustered: boolean;
  onClusteredChange: (c: boolean) => void;
  liveMode: boolean;
  neighborLines: NeighborLinesMode;
  onNeighborLinesChange: (mode: NeighborLinesMode) => void;
  borders: boolean;
  onBordersChange: (on: boolean) => void;
  // MeshCore region token ("" = All); options combine the built-in catalogue and discovery.
  meshcoreRegion: string;
  onMeshcoreRegionChange: (token: string) => void;
  // builds deep-link params for the current view, evaluated at copy time (reads the live camera)
  buildShareParams: () => Record<string, string | null>;
  children?: ReactNode;
}

export function MapSettingsPanel({
  typeFilter,
  onTypeChange,
  clustered,
  onClusteredChange,
  liveMode,
  neighborLines,
  onNeighborLinesChange,
  borders,
  onBordersChange,
  meshcoreRegion,
  onMeshcoreRegionChange,
  buildShareParams,
  children,
}: MapSettingsPanelProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const typeOptions = [{ value: '', label: t('common.all') }, ...NODE_TYPE_FILTER_OPTIONS];
  const neighborOptions = [
    { value: 'on', label: t('map.on') },
    { value: 'selected', label: t('map.selected') },
    { value: 'off', label: t('map.off') },
  ];
  // Built-in and discovered MeshCore regions, with confirmed-node counts.
  const { data: meshcoreRegions } = useQuery(meshcoreRegionQueries.list());
  const meshcoreOptions = (meshcoreRegions ?? [])
    .map((region) => ({ value: region.token, label: `${region.token} · ${region.nodeCount}` }))
    .filter((option) => option.value === meshcoreRegion || option.value !== '');
  if (meshcoreRegion && !meshcoreOptions.some((option) => option.value === meshcoreRegion)) {
    meshcoreOptions.push({ value: meshcoreRegion, label: meshcoreRegion });
  }
  // Start with the map visible on every visit; filter/layer preferences still live in MapView.
  const [open, setOpen] = useState(false);
  const filterCount = Number(Boolean(typeFilter)) + Number(Boolean(meshcoreRegion));

  return (
    <div
      className={`relative flex min-h-0 max-h-full min-w-0 max-w-full flex-col bg-bg-raised border border-border rounded-md shadow-lg overflow-hidden font-mono ${open ? 'w-64' : 'w-fit'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('map.settings')}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex shrink-0 items-center justify-between gap-2 w-full px-3 py-2 text-size-11 text-text-muted hover:text-text-normal transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M2 4.5h7M2 11.5h4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <circle cx="12" cy="4.5" r="1.7" fill="currentColor" />
            <circle cx="9" cy="11.5" r="1.7" fill="currentColor" />
            <path
              d="M9 11.5h5M12 4.5h2"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          {t('map.settings')}
        </span>
        {filterCount > 0 && (
          <span className="rounded-sm bg-primary/15 px-1 text-size-9 text-primary">
            {filterCount}
          </span>
        )}
        <span aria-hidden className="text-text-dim text-size-9">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className="min-h-0 overflow-y-auto overscroll-contain border-t border-border-subtle"
        >
          <div className="space-y-2 px-3 py-2.5">
            <SegmentedControl
              wrap
              ariaLabel={t('map.nodeType')}
              options={typeOptions}
              value={typeFilter}
              onChange={onTypeChange}
            />
            <MeshCoreRegionPicker
              counts
              label={t('map.meshcoreRegion')}
              options={meshcoreOptions}
              selected={meshcoreRegion ? [meshcoreRegion] : []}
              onChange={(values) => onMeshcoreRegionChange(values[0] ?? '')}
              align="left"
              fullWidth
            />
            {meshcoreRegion && (
              <p className="text-size-10 text-text-dim">{t('map.meshcoreRegionHint')}</p>
            )}
          </div>
          <div className="space-y-2 px-3 py-2.5 border-t border-border-subtle">
            <label className="flex items-center justify-between gap-2 text-xs text-text-normal cursor-pointer">
              {t('map.clustering')}
              <input
                type="checkbox"
                role="switch"
                checked={clustered && !liveMode}
                disabled={liveMode}
                onChange={(event) => onClusteredChange(event.target.checked)}
                className="accent-primary disabled:opacity-40"
              />
            </label>
            {liveMode && (
              <p className="text-size-10 text-text-dim">{t('map.liveUnclusteredHint')}</p>
            )}
            <label className="flex items-center justify-between gap-2 text-xs text-text-normal cursor-pointer">
              {t('map.iataBorders')}
              <input
                type="checkbox"
                role="switch"
                checked={borders}
                onChange={(event) => onBordersChange(event.target.checked)}
                className="accent-primary"
              />
            </label>
          </div>
          <div className="space-y-1.5 px-3 py-2.5 border-t border-border-subtle">
            <div className="text-xs text-text-normal">{t('map.neighborLines')}</div>
            <SegmentedControl
              ariaLabel={t('map.neighborLines')}
              options={neighborOptions}
              value={neighborLines}
              onChange={(v) => onNeighborLinesChange(v as NeighborLinesMode)}
              className="w-full"
            />
            {liveMode && neighborLines !== 'off' && (
              <p className="text-size-10 text-text-dim">{t('map.liveNeighborHint')}</p>
            )}
          </div>
          {children}
          <div className="px-3 py-2.5 border-t border-border-subtle flex justify-end">
            <CopyLinkButton
              params={buildShareParams}
              label={t('map.copyLink')}
              ariaLabel={t('map.copyLinkLabel')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
