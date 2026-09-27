// Observer "eye" glyph. Matches the map's observer pip (OBSERVER_COLOR in
// features/map/node-icons.ts) through the shared observer theme token.
export function ObserverIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2 12C5 6.5 19 6.5 22 12 19 17.5 5 17.5 2 12Z"
        stroke="var(--color-observer)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="var(--color-observer)" />
    </svg>
  );
}
