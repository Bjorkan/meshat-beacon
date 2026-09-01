import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Popover from '@radix-ui/react-popover';
import { useHasHover } from '../hooks/useMediaQuery';

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MultiSelectDropdownProps {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  searchable?: boolean;
  align?: 'left' | 'right';
  fullWidth?: boolean;
}

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  searchable,
  align = 'left',
  fullWidth = false,
}: MultiSelectDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasHover = useHasHover();
  const showSearch = searchable ?? options.length > 6;
  const count = selected.length;
  const filtered = useMemo(() => {
    const query = filter.toLowerCase();
    return query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options;
  }, [options, filter]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFilter('');
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-sm border font-mono cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-primary ${
            fullWidth ? 'w-full justify-between' : ''
          } ${
            count > 0
              ? 'border-primary-dim bg-primary/6 text-primary'
              : 'border-border bg-bg-surface text-text-muted hover:border-text-dim hover:text-text-normal'
          }`}
        >
          {label}
          <span
            className={`text-[9px] px-1 rounded-sm min-w-[1ch] text-center ${count > 0 ? 'bg-primary/15' : 'invisible'}`}
          >
            {count || 0}
          </span>
          <span className="text-text-dim text-[9px]">▾</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align === 'right' ? 'end' : 'start'}
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            if (!showSearch) return;
            event.preventDefault();
            if (hasHover) inputRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (!filter) return;
            event.preventDefault();
            setFilter('');
          }}
          className={`${fullWidth ? 'w-[var(--radix-popover-trigger-width)]' : 'w-52'} max-w-[calc(100vw-1.5rem)] bg-bg-raised border border-border rounded-md shadow-lg z-50 py-1 focus:outline-none`}
        >
          {showSearch && (
            <div className="px-2 pb-1">
              <input
                ref={inputRef}
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('filters.filterPlaceholder')}
                className="w-full text-[11px] font-mono bg-bg-surface border border-border rounded px-2 py-1 text-text-bright placeholder:text-text-dim"
              />
            </div>
          )}
          <div className="flex items-center gap-1 px-2 py-1 border-b border-border-subtle mb-1">
            <button
              type="button"
              className={
                count === options.length
                  ? 'text-primary text-[11px] font-mono'
                  : 'text-text-muted hover:text-text-normal text-[11px] font-mono'
              }
              onClick={() =>
                onChange(options.filter((option) => !option.disabled).map((option) => option.value))
              }
            >
              {t('common.all')}
            </button>
            <span className="text-border text-[11px]">·</span>
            <button
              type="button"
              className={
                count === 0
                  ? 'text-primary text-[11px] font-mono'
                  : 'text-text-muted hover:text-text-normal text-[11px] font-mono'
              }
              onClick={() => onChange([])}
            >
              {t('common.none')}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto" aria-label={label}>
            {filtered.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`w-full flex items-center gap-2 px-2.5 py-1 text-left text-xs font-mono transition-colors ${
                    option.disabled
                      ? 'opacity-40'
                      : checked
                        ? 'text-text-bright bg-primary/10 cursor-pointer'
                        : 'text-text-muted hover:text-text-normal hover:bg-text-normal/3 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={option.disabled}
                    checked={checked}
                    onChange={() =>
                      onChange(
                        checked
                          ? selected.filter((value) => value !== option.value)
                          : [...selected, option.value],
                      )
                    }
                    className="accent-primary"
                  />
                  {option.label}
                </label>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-[11px] font-mono text-text-dim">
                {t('common.noMatches')}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
