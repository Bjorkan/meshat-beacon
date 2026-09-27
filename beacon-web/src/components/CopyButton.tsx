import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { VARIANT_CLASSES } from './badge-utils';

const COPY_BUTTON_VARIANT_CLASSES = {
  default: 'font-mono text-size-11 px-2 py-0.5 rounded-sm tracking-wider uppercase',
  action:
    'rounded-full px-3 font-sans text-xs tracking-normal normal-case focus-visible:outline-2 focus-visible:outline-primary',
} as const;

// Copy-to-clipboard pill, styled to match the analyzer's "Copy Link" button: flips to a green
// "Copied" state for 1.5s after a click. aria-label defaults to the visible label.
export function CopyButton({
  value,
  label,
  copiedLabel,
  ariaLabel,
  variant = 'default',
  className,
}: {
  value: string | (() => string);
  label?: string;
  copiedLabel?: string;
  ariaLabel?: string;
  variant?: keyof typeof COPY_BUTTON_VARIANT_CLASSES;
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
      className={`inline-flex items-center border font-semibold cursor-pointer transition-colors ${COPY_BUTTON_VARIANT_CLASSES[variant]} ${copied ? VARIANT_CLASSES.live : VARIANT_CLASSES.text} ${className ?? ''}`}
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
