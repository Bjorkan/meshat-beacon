import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { VARIANT_CLASSES } from './badge-utils';

// Copy-to-clipboard pill, styled to match the analyzer's "Copy Link" button: flips to a green
// "Copied" state for 1.5s after a click. aria-label defaults to the visible label.
export function CopyButton({
  value,
  label,
  copiedLabel,
  ariaLabel,
  className,
}: {
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const copied = status === 'copied';
  const visibleLabel = label ?? t('common.copy');
  const visibleCopiedLabel = copiedLabel ?? t('common.copied');

  const handleCopy = useCallback(async () => {
    clearTimeout(resetTimer.current);
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(typeof value === 'function' ? value() : value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    resetTimer.current = setTimeout(() => setStatus('idle'), 1500);
  }, [value]);

  return (
    <button
      type="button"
      className={`inline-flex items-center font-mono text-[11px] font-semibold px-2 py-0.5 rounded-sm border tracking-wider uppercase cursor-pointer transition-colors ${copied ? VARIANT_CLASSES.live : VARIANT_CLASSES.text} ${className ?? ''}`}
      onClick={handleCopy}
      disabled={status === 'copying'}
      aria-label={ariaLabel ?? visibleLabel}
    >
      <span aria-live="polite">
        {copied ? visibleCopiedLabel : status === 'failed' ? t('common.copyFailed') : visibleLabel}
      </span>
    </button>
  );
}
