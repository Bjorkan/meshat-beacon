// NodeLabel: unified node identity for the route planner ONLY (do not reuse
// elsewhere — other views keep their own established formats).
// Rule: node name first, then the public key's first 3 bytes (6 hex chars,
// uppercase) in grey. Never a UUID: callers pass the full pubkey. Nameless
// nodes show the prefix in normal color with no grey suffix.
import { formatNodePrefix } from '../../lib/formatters';

export function NodeLabel({
  name,
  publicKey,
  className = '',
}: {
  name?: string | null;
  publicKey: string;
  className?: string;
}) {
  const prefix = formatNodePrefix(publicKey);
  const shown = name ?? prefix;
  const ariaLabel = name ? `${name}, ${prefix}` : prefix;
  return (
    <span
      className={`inline-flex min-w-0 items-baseline gap-1.5 ${className}`}
      title={publicKey}
      aria-label={ariaLabel}
    >
      <span className="min-w-0 truncate font-semibold">{shown}</span>
      {name && (
        <span className="shrink-0 font-mono text-[11px] text-text-muted" aria-hidden="true">
          {prefix}
        </span>
      )}
    </span>
  );
}
