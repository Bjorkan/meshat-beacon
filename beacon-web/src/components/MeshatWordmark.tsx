// Meshat.se wordmark: rounded logo tile + wordmark, inlined from the original SVG so the text can
// follow the active theme — an <img> can't inherit CSS, which made the mark vanish in light mode.
// The tile keeps the fixed brand green (#1f7a3d) with the white glyph in both themes; only the
// wordmark text recolors (currentColor).
export function MeshatWordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex h-7 items-center text-text-bright ${className ?? ""}`}>
      <svg viewBox="0 0 393 120" className="block h-full w-auto max-w-full" role="img" aria-label="Meshat.se">
        <g transform="translate(12 12) scale(4)">
          <rect width="24" height="24" rx="5" fill="#1f7a3d" />
          <g
            transform="translate(2 2) scale(0.8333333333)"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
            <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
            <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
            <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
            <circle cx="12" cy="9" r="2" />
            <path d="M9.5 18h5" />
            <path d="m8 22 4-11 4 11" />
          </g>
        </g>
        <text
          x="132"
          y="77"
          fill="currentColor"
          fontFamily="Inter, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
          fontSize="50"
          fontWeight="700"
          letterSpacing="-1"
        >
          Meshat.se
        </text>
      </svg>
    </span>
  );
}
