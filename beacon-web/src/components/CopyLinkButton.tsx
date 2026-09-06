import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';

// Copies a shareable deep link to the current page with the given query params set (built fresh from
// the address bar at click time, so region/other params are preserved). Flips to "Copied" for 1.5s.
// `params` may be a static map or a thunk evaluated on click — the thunk form can read live state
// (e.g. the map camera) and use a null value to delete a key that's now at its default.
export function CopyLinkButton({
  to,
  params,
  label,
  copiedLabel,
  ariaLabel,
}: {
  to?: string;
  params: Record<string, string> | (() => Record<string, string | null>);
  label?: string;
  copiedLabel?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const visibleLabel = label ?? t('common.copyLink');

  const getValue = useCallback(() => {
    const url = new URL(window.location.href);
    if (to) url.pathname = to;
    const resolved = typeof params === 'function' ? params() : params;
    for (const [key, value] of Object.entries(resolved)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    return url.toString();
  }, [params, to]);

  return (
    <CopyButton
      value={getValue}
      label={visibleLabel}
      copiedLabel={copiedLabel}
      ariaLabel={ariaLabel}
    />
  );
}
