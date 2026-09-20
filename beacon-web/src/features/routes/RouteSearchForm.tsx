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
    <div className="flex items-center gap-3">
      <div aria-hidden className="flex w-4 shrink-0 flex-col items-center gap-1.5">
        <span className="h-3 w-3 rounded-full border-[3px] border-primary" />
        <span className="h-7 border-l-2 border-dotted border-text-muted/50" />
        <svg
          width="18"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-danger"
        >
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <NodeCombobox
          label={t('routes.from')}
          value={resolvedFrom}
          onPick={(p) => onPair(p, resolvedTo)}
          onClear={onClearFrom}
          excludePublicKey={resolvedTo?.publicKey}
          autoFocus={autoFocus}
        />
        <NodeCombobox
          label={t('routes.to')}
          value={resolvedTo}
          onPick={(p) => onPair(resolvedFrom, p)}
          onClear={onClearTo}
          excludePublicKey={resolvedFrom?.publicKey}
        />
      </div>
      <button
        type="button"
        aria-label={t('routes.swap')}
        title={t('routes.swap')}
        onClick={onSwap}
        disabled={!resolvedFrom && !resolvedTo}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-raised hover:text-text-bright disabled:opacity-40"
      >
        <svg
          aria-hidden
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 20V4m-4 4 4-4 4 4M17 4v16m-4-4 4 4 4-4" />
        </svg>
      </button>
    </div>
  );
}
