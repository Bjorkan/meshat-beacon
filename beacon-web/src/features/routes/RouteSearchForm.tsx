import { useTranslation } from 'react-i18next';
import { NodeCombobox, type NodePick } from './NodeCombobox';

export function RouteSearchForm({
  resolvedFrom,
  resolvedTo,
  onPair,
  onSwap,
  onClearFrom,
  onClearTo,
  autoFocus,
}: {
  resolvedFrom: NodePick | null;
  resolvedTo: NodePick | null;
  onPair: (from: NodePick | null, to: NodePick | null) => void;
  onSwap: () => void;
  onClearFrom: () => void;
  onClearTo: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <NodeCombobox
        label={t('routes.from')}
        value={resolvedFrom}
        onPick={(p) => onPair(p, resolvedTo)}
        onClear={onClearFrom}
        excludePublicKey={resolvedTo?.publicKey}
        autoFocus={autoFocus}
      />
      <div className="flex items-center gap-2">
        <div className="px-1 font-mono text-[11px] text-text-dim">{t('routes.globalHint')}</div>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t('routes.swap')}
          title={t('routes.swap')}
          onClick={onSwap}
          disabled={!resolvedFrom && !resolvedTo}
          className="shrink-0 rounded border border-border bg-bg-surface px-2 py-1 font-mono text-text-muted hover:border-text-dim hover:text-text-normal disabled:opacity-40"
        >
          ⇅
        </button>
      </div>
      <NodeCombobox
        label={t('routes.to')}
        value={resolvedTo}
        onPick={(p) => onPair(resolvedFrom, p)}
        onClear={onClearTo}
        excludePublicKey={resolvedFrom?.publicKey}
      />
    </div>
  );
}
