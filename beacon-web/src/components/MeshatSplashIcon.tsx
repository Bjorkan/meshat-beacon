interface MeshatSplashIconProps {
  size?: number;
  className?: string;
}

export function MeshatSplashIcon({ size = 160, className }: MeshatSplashIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-testid="meshat-splash-icon"
      className={className}
    >
      <rect x="12" y="12" width="96" height="96" rx="20" fill="#1f7a3d" />
      <g
        transform="translate(20 20) scale(3.3333333332)"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g
          className="meshat-radio-wave-outer"
          data-testid="meshat-radio-wave-outer"
        >
          <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
          <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
        </g>
        <g
          className="meshat-radio-wave-inner"
          data-testid="meshat-radio-wave-inner"
        >
          <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
          <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
        </g>
        <circle cx="12" cy="9" r="2" />
        <path d="M9.5 18h5" />
        <path d="m8 22 4-11 4 11" />
      </g>
    </svg>
  );
}
