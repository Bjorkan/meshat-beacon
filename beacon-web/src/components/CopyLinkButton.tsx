import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { VARIANT_CLASSES } from "./badge-utils";

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
  const [copied, setCopied] = useState(false);
  const visibleLabel = label ?? t("common.copyLink");
  const visibleCopiedLabel = copiedLabel ?? t("common.copied");

  const handleCopy = useCallback(() => {
    const url = new URL(window.location.href);
    if (to) url.pathname = to;
    const resolved = typeof params === "function" ? params() : params;
    for (const [key, value] of Object.entries(resolved)) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [params, to]);

  return (
    <button
      type="button"
      className={`inline-flex items-center font-mono text-[11px] font-semibold px-2 py-0.5 rounded-sm border tracking-wider uppercase cursor-pointer transition-colors ${copied ? VARIANT_CLASSES.live : VARIANT_CLASSES.text}`}
      onClick={handleCopy}
      aria-label={ariaLabel ?? visibleLabel}
    >
      {copied ? visibleCopiedLabel : visibleLabel}
    </button>
  );
}
