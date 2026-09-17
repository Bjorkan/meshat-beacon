// NodeCombobox: Google-Maps-like node picker for the route planner (local to
// features/routes — do not reuse elsewhere). Free text with suggestions:
// hex-looking input searches by pubkey prefix, anything else by name (same
// rule as node-search.ts). A pasted FULL public key resolves exactly.
// Nodes without coordinates are shown disabled with a hint — they can never
// be drawn on the map, so they can never be a route endpoint.
//
// The planner is repeater-only end-to-end (MeshCore repeater routes): only
// repeater nodes (nodeType 2) are listed, resolvable, or committable here.
// Non-repeaters never appear as suggestions and are rejected on exact-key
// entry, so no code path in this picker can produce a non-repeater endpoint.
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getNodesPage } from '../../api/client';
import { NodeLabel } from './NodeLabel';
import type { NodeSummary } from '../nodes/types';

export interface NodePick {
  publicKey: string; // full key, lowercase hex
  name: string | null;
  lat: number | null;
  lng: number | null;
  nodeType: number; // 2 = repeater; the planner only ever picks repeaters
}

function toPick(n: NodeSummary): NodePick {
  return {
    publicKey: n.publicKey.toLowerCase(),
    name: n.name,
    lat: n.lat,
    lng: n.lng,
    nodeType: n.nodeType,
  };
}

function isHexLike(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

export function NodeCombobox({
  label,
  value,
  onPick,
  onClear,
  excludePublicKey,
  autoFocus,
}: {
  label: string;
  value: NodePick | null;
  onPick: (pick: NodePick) => void;
  onClear: () => void;
  excludePublicKey?: string | null;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(
    value ? (value.name ?? value.publicKey.slice(0, 6).toUpperCase()) : '',
  );
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [debounced, setDebounced] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const inputId = useId();
  // Last text pushed from an external pick (swap, URL restore, clear): when
  // the pick changes, the text follows it. Typing sets text directly without
  // touching this marker, so keystrokes never fight the sync.
  const [syncedText, setSyncedText] = useState(text);
  const externalText = value ? (value.name ?? value.publicKey.slice(0, 6).toUpperCase()) : '';
  if (externalText !== syncedText) {
    setSyncedText(externalText);
    if (text !== externalText) setText(externalText);
  }

  // debounce so the server lookup fires once per pause, not once per keystroke
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  // close on outside click
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as HTMLElement)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const query = debounced;
  const hexLike = isHexLike(query.replace(/\s+/g, ''));
  const { data, isLoading } = useQuery({
    queryKey: ['routes-node-suggest', query.toLowerCase()],
    queryFn: () =>
      getNodesPage(undefined, {
        limit: 8,
        sort: 'name',
        direction: 'asc',
        type: 'repeater',
        ...(hexLike ? { pubkeyPrefix: query.replace(/\s+/g, '').toLowerCase() } : { name: query }),
      }),
    enabled: open && query.length > 0 && !(value && query === (value.name ?? '')),
    staleTime: 30_000,
  });
  // Belt and suspenders: the server filters type=repeater, but never trust a
  // non-repeater suggestion through any picker path.
  const suggestions = (data?.items ?? []).filter(
    (n) => n.nodeType === 2 && n.publicKey.toLowerCase() !== excludePublicKey?.toLowerCase(),
  );

  const commit = (pick: NodePick) => {
    setOpen(false);
    onPick(pick);
  };

  // full pubkey pasted (or typed): resolve exactly on Enter. Only a full
  // 64-hex key for a REPEATER can become a route endpoint (matching
  // /routes/best, which 400s non-repeater endpoints).
  const commitExactKey = async (raw: string) => {
    const hex = raw.replace(/\s+/g, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return false;
    const page = await getNodesPage(undefined, { pubkeyPrefix: hex, limit: 10 });
    const exact = page.items.find((n) => n.publicKey.toLowerCase() === hex);
    if (exact) {
      if (exact.nodeType !== 2) return 'nonrepeater';
      if (exact.lat == null || exact.lng == null) return 'noloc';
      if (exact.publicKey.toLowerCase() === excludePublicKey?.toLowerCase()) return 'excluded';
      commit(toPick(exact));
      return true;
    }
    return false;
  };
  const [notice, setNotice] = useState<string | null>(null);

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlight((h) => {
        const n = suggestions.length;
        if (n === 0) return 0;
        return e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n;
      });
      return;
    }
    if (e.key === 'Enter') {
      const current = suggestions[highlight];
      if (open && current) {
        e.preventDefault();
        if (current.lat == null || current.lng == null) {
          setNotice(t('routes.noPositionHint'));
          return;
        }
        commit(toPick(current));
        return;
      }
      // no suggestion highlighted: try an exact full-key match
      const result = await commitExactKey(text);
      if (result === 'nonrepeater') setNotice(t('routes.nonRepeaterEndpoint'));
      else if (result === 'noloc') setNotice(t('routes.noPositionHint'));
      else if (result === 'excluded') setNotice(t('routes.sameNodeHint'));
      else if (result === false) setNotice(t('routes.noMatchHint'));
      else setNotice(null);
    }
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <label
        htmlFor={inputId}
        className="mb-1 block text-[11px] font-mono uppercase tracking-wider text-text-muted"
      >
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            open && suggestions[highlight] ? `${listId}-${highlight}` : undefined
          }
          autoFocus={autoFocus}
          className="min-w-0 flex-1 rounded-sm border border-border bg-bg-surface px-2 py-1.5 font-mono text-[13px] text-text-bright placeholder:text-text-dim"
          placeholder={t('routes.nodeSearchPlaceholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHighlight(0);
            setNotice(null);
            if (e.target.value === '') onClear();
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button"
            aria-label={t('common.clear')}
            onClick={() => {
              setText('');
              setNotice(null);
              onClear();
            }}
            className="shrink-0 rounded px-1.5 py-1 font-mono text-text-dim hover:text-text-normal"
          >
            ×
          </button>
        )}
      </div>
      {notice && (
        <div role="status" className="mt-1 font-mono text-[11px] text-warn">
          {notice}
        </div>
      )}
      {open && query.length > 0 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1">
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-y-auto rounded border border-border bg-bg-raised py-1 shadow-lg"
          >
            {isLoading && (
              <li role="status" className="px-3 py-2 font-mono text-xs text-text-dim">
                {t('common.loading')}
              </li>
            )}
            {!isLoading && suggestions.length === 0 && (
              <li className="px-3 py-2 font-mono text-xs text-text-dim">
                {t('routes.noMatchHint')}
              </li>
            )}
            {suggestions.map((n, i) => {
              const located = n.lat != null && n.lng != null;
              return (
                <li
                  key={n.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  aria-disabled={!located}
                >
                  <button
                    type="button"
                    disabled={!located}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => located && commit(toPick(n))}
                    title={located ? n.publicKey : `${n.publicKey} · ${t('routes.noPositionHint')}`}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                      i === highlight ? 'bg-text-normal/5' : ''
                    } ${located ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <NodeLabel name={n.name} publicKey={n.publicKey} />
                    </span>
                    <span className="shrink-0 font-mono text-[11px]" aria-hidden="true">
                      {located ? '📍' : '🚫'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
