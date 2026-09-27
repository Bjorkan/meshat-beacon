import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { meshcoreRegionQueries } from '../api/queries';
import { useIsMobile } from '../hooks/useMediaQuery';

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  fullWidth?: boolean;
  align?: 'left' | 'right';
  allLabel?: string;
  counts?: boolean;
}

// Browsing a country/county never selects its descendants. Each selection is
// an exact radio token, independent of the cosmetic hierarchy and IATA filters.
export function MeshCoreRegionPicker({
  label,
  options,
  selected,
  onChange,
  multiple = false,
  fullWidth = false,
  align = 'left',
  allLabel,
  counts = false,
}: Props) {
  const { t } = useTranslation();
  const {
    data: regions = [],
    isPending,
    isError,
    refetch,
  } = useQuery(meshcoreRegionQueries.list());
  const isMobile = useIsMobile();
  const groupName = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [parentToken, setParentToken] = useState<string>();
  const metadata = new Map(regions.map((region) => [region.token, region]));
  const nodes = options.map((option) => {
    const region = metadata.get(option.value.replace(/^#/, ''));
    return {
      ...option,
      token: region?.token ?? option.value,
      parent: region?.parentToken,
      label: region?.displayName ? `${region.token} · ${region.displayName}` : option.label,
      displayName: region?.displayName,
      level: region?.level,
      count: region?.nodeCount,
    };
  });
  // Saved/custom selections remain visible and clearable even after discovery expires.
  for (const value of selected) {
    if (!nodes.some((node) => node.value === value)) {
      nodes.push({
        value,
        token: value,
        label: value,
        displayName: undefined,
        parent: undefined,
        level: undefined,
        count: undefined,
      });
    }
  }
  const tokens = new Set(nodes.map((node) => node.token));
  const sorted = [...nodes].sort(
    (a, b) =>
      Number(b.level === 'country') - Number(a.level === 'country') ||
      (a.displayName ?? a.label).localeCompare(b.displayName ?? b.label, 'sv'),
  );
  const children = (parent?: string) =>
    sorted.filter((node) =>
      parent ? node.parent === parent : !node.parent || !tokens.has(node.parent),
    );
  const current = nodes.find((node) => node.token === parentToken);
  const trail: typeof nodes = [];
  let ancestor = current;
  while (ancestor && !trail.some((node) => node.token === ancestor?.token)) {
    trail.unshift(ancestor);
    const token = ancestor.parent;
    ancestor = nodes.find((node) => node.token === token);
  }
  const query = search.trim().toLocaleLowerCase('sv');
  const visible = query
    ? sorted.filter((node) => `${node.label} ${node.value}`.toLocaleLowerCase('sv').includes(query))
    : children(current?.token);
  const browse = (token?: string) => {
    setParentToken(token);
    setSearch('');
  };
  const choose = (value: string) => {
    onChange(
      multiple
        ? selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value]
        : [value],
    );
    if (!multiple) setOpen(false);
  };
  const renderNode = (node: (typeof nodes)[number], allowBrowse = true) => {
    const canBrowse = allowBrowse && children(node.token).length > 0;
    const checked = selected.includes(node.value);
    const inputID = `${groupName}-${encodeURIComponent(node.value)}`;
    const text = (
      <>
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-mono text-[13px] font-medium tracking-wide">
            {node.token}
          </span>
          {node.displayName && (
            <span className="block text-xs text-text-muted leading-snug">{node.displayName}</span>
          )}
        </span>
        {counts && node.count !== undefined && (
          <span
            title={t('regionPicker.confirmedNodes')}
            className="text-[11px] text-text-dim tabular-nums"
          >
            {node.count}
          </span>
        )}
      </>
    );
    return (
      <div
        key={node.value}
        className={`flex items-stretch rounded-md border transition-colors ${checked ? 'border-primary/30 bg-primary/10 text-primary' : 'border-transparent text-text-normal hover:bg-text-normal/5'}`}
      >
        <label className="order-last flex w-10 shrink-0 items-center justify-center cursor-pointer">
          <input
            type={multiple ? 'checkbox' : 'radio'}
            id={inputID}
            name={multiple ? undefined : groupName}
            aria-label={node.label}
            checked={checked}
            onChange={() => choose(node.value)}
            className="h-4 w-4 accent-primary cursor-pointer"
          />
        </label>
        {canBrowse ? (
          <button
            type="button"
            aria-label={node.label}
            onClick={() => browse(node.token)}
            className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-1 cursor-pointer rounded-l-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {text}
            <span aria-hidden className="text-text-muted text-lg">
              ›
            </span>
          </button>
        ) : (
          <label
            htmlFor={inputID}
            className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-1 cursor-pointer"
          >
            {text}
          </label>
        )}
      </div>
    );
  };
  const selectionLabel = selected
    .map((value) => nodes.find((node) => node.value === value)?.label ?? value)
    .join(', ');
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSearch('');
        if (next)
          setParentToken(
            selected.length === 1
              ? nodes.find((node) => node.value === selected[0])?.parent
              : undefined,
          );
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={selectionLabel}
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-sm border font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary ${fullWidth ? 'w-full justify-between' : ''} ${selected.length ? 'border-primary-dim bg-primary/6 text-primary' : 'border-border bg-bg-surface text-text-muted'}`}
        >
          <span className="shrink-0">{label}</span>
          <span className="min-w-0 truncate">
            {selected.length === 1 ? selected[0] : selected.length || allLabel || t('common.all')}
          </span>
          <span aria-hidden>▾</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={t('regionPicker.title')}
          align={align === 'right' ? 'end' : 'start'}
          side={isMobile ? 'top' : 'bottom'}
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            if (isMobile) event.preventDefault();
          }}
          className="flex flex-col w-96 max-w-[calc(100vw-1.5rem)] max-h-[min(36rem,var(--radix-popover-content-available-height))] bg-bg-raised border border-border rounded-xl shadow-xl z-50 overflow-hidden"
        >
          <div className="shrink-0 px-3 pt-3 pb-2 border-b border-border-subtle">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm font-medium text-text-bright">
                {t('regionPicker.title')}
              </span>
              <Popover.Close
                aria-label={t('common.close')}
                className="w-7 h-7 rounded text-text-muted hover:bg-text-normal/5 cursor-pointer"
              >
                ×
              </Popover.Close>
            </div>
            <input
              aria-label={t('regionPicker.search')}
              placeholder={t('regionPicker.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full text-base sm:text-sm bg-bg-surface border border-border rounded-md px-3 py-2 text-text-normal placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <nav
              aria-label={t('regionPicker.navigation')}
              className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-2 text-xs"
            >
              <button
                type="button"
                className="text-text-muted hover:text-primary py-1 cursor-pointer"
                onClick={() => browse()}
              >
                {t('regionPicker.allRegions')}
              </button>
              {trail.map((node) => (
                <span key={node.token} className="flex items-center gap-1 min-w-0">
                  <span aria-hidden className="text-text-dim">
                    ›
                  </span>
                  <button
                    type="button"
                    aria-current={node === current ? 'location' : undefined}
                    className="text-text-normal hover:text-primary py-1 cursor-pointer"
                    onClick={() => browse(node.token)}
                  >
                    {node.displayName ?? node.token}
                  </button>
                </span>
              ))}
            </nav>
          </div>
          <div
            role={multiple ? 'group' : 'radiogroup'}
            aria-label={label}
            className="flex flex-col min-h-0"
          >
            {current && !query && (
              <div className="shrink-0 px-2 py-2 border-b border-border-subtle">
                {renderNode(current, false)}
              </div>
            )}
            <div className="px-3 pt-2 pb-1 shrink-0 text-[10px] uppercase tracking-wider text-text-dim">
              {query
                ? t('regionPicker.results')
                : current?.level === 'country'
                  ? t('regionPicker.counties')
                  : current?.level === 'county'
                    ? t('regionPicker.municipalities')
                    : t('regionPicker.regions')}
            </div>
            <div
              key={query || current?.token || 'root'}
              className="min-h-0 max-h-72 overflow-y-auto overscroll-contain px-2 pb-2"
            >
              {isPending ? (
                <div role="status" className="p-3 text-sm text-text-muted">
                  {t('common.loading')}
                </div>
              ) : isError ? (
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="p-3 text-sm text-primary"
                >
                  {t('common.retry')}
                </button>
              ) : (
                visible.map((node) => renderNode(node))
              )}
              {!isPending && !isError && !visible.length && (
                <div className="p-3 text-sm text-text-dim">{t('common.noMatches')}</div>
              )}
            </div>
          </div>
          <div className="shrink-0 border-t border-border-subtle px-3 py-2.5 bg-bg-surface">
            {selected.length > 0 ? (
              <>
                <div className="flex items-center justify-between gap-2 mb-2 text-xs">
                  <span className="text-text-muted">
                    {t('regionPicker.selected', { count: selected.length })}
                  </span>
                  <button
                    type="button"
                    className="text-primary cursor-pointer"
                    onClick={() => {
                      onChange([]);
                      if (!multiple) setOpen(false);
                    }}
                  >
                    {t('common.clearAll')}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                  {selected.map((value) => (
                    <button
                      key={value}
                      type="button"
                      title={nodes.find((node) => node.value === value)?.label}
                      aria-label={t('regionPicker.remove', { token: value })}
                      onClick={() => onChange(selected.filter((item) => item !== value))}
                      className="inline-flex items-center gap-2 px-2 py-1 rounded border border-primary/25 bg-primary/8 text-primary text-xs font-mono cursor-pointer"
                    >
                      {value}
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-text-muted leading-relaxed">{t('regionPicker.hint')}</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
