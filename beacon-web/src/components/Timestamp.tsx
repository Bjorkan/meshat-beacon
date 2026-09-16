import { useTick } from '../hooks/useTick';
import { Tooltip } from './Tooltip';
import { timeAgoMs, formatAbsolute } from '../lib/formatters';
import { useTranslation } from 'react-i18next';

interface TimestampProps {
  value: number; // epoch ms
  mode?: 'relative' | 'absolute'; // default "relative"
  ms?: boolean; // include .mmm in the absolute form (default false)
  className?: string;
  insideButton?: boolean;
  // Dense tables (200 virtualized trace rows = ~400 instances) must stay cheap: plain text
  // with the absolute time as a native title, no ticker subscription, no Radix tooltip tree.
  // Default false preserves the live relative label + rich tooltip everywhere else.
  static?: boolean;
}

// The single way to render a timestamp across the app. Defaults to a relative label ("2m ago") with
// the full absolute time on hover (via the custom Tooltip, which shows instantly — the native title
// attribute lagged ~1s); "absolute" mode flips the two. Self-refreshes via the shared ticker, so
// callers don't sprinkle useTick() or build their own tooltips.
export function Timestamp({
  value,
  mode = 'relative',
  ms,
  className,
  insideButton,
  static: staticText,
}: TimestampProps) {
  return staticText ? (
    <StaticTimestamp value={value} mode={mode} ms={ms} className={className} />
  ) : (
    <LiveTimestamp
      value={value}
      mode={mode}
      ms={ms}
      className={className}
      insideButton={insideButton}
    />
  );
}

// Static mode: no useTick subscription, no tooltip tree — safe inside 200-row tables.
function StaticTimestamp({
  value,
  mode = 'relative',
  ms,
  className,
}: Pick<TimestampProps, 'value' | 'mode' | 'ms' | 'className'>) {
  const { t } = useTranslation();
  const text =
    mode === 'absolute'
      ? formatAbsolute(value, { ms })
      : t('common.ageAgo', { age: timeAgoMs(value) });
  const hint =
    mode === 'absolute'
      ? t('common.ageAgo', { age: timeAgoMs(value) })
      : formatAbsolute(value, { ms });
  return (
    <span className={`whitespace-nowrap ${className ?? ''}`} title={hint}>
      {text}
    </span>
  );
}

function LiveTimestamp({
  value,
  mode = 'relative',
  ms,
  className,
  insideButton,
}: Omit<TimestampProps, 'static'>) {
  const { t } = useTranslation();
  useTick(); // keep the relative label fresh

  const relative = t('common.ageAgo', { age: timeAgoMs(value) });
  const absolute = formatAbsolute(value, { ms });

  if (insideButton)
    return (
      <span className={className} title={mode === 'absolute' ? relative : absolute}>
        {mode === 'absolute' ? absolute : relative}
      </span>
    );

  return (
    <Tooltip label={mode === 'absolute' ? relative : absolute} className={className}>
      {mode === 'absolute' ? absolute : relative}
    </Tooltip>
  );
}
