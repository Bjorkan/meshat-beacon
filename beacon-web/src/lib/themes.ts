// theme loading and CSS var injection

export interface Theme {
  id: string;
  name: string;
  vars: Record<string, string>;
  // hidden themes are omitted from the picker unless enabled via VITE_ENABLED_THEMES
  hidden?: boolean;
}

export const DEFAULT_THEME_ID = "meshat-dark";

const FALLBACK: Theme = {
  id: "meshat-dark",
  name: "Meshat Dark",
  vars: {
    "--palette-bg-base": "#111827",
    "--palette-bg-surface": "#1F2937",
    "--palette-bg-raised": "#263243",
    "--palette-border": "#374151",
    "--palette-border-subtle": "#2C3844",
    "--palette-primary": "#5CCE7A",
    "--palette-primary-dim": "#349251",
    "--palette-secondary": "#67EA94",
    "--palette-green": "#5CCE7A",
    "--palette-danger": "#FF8A80",
    "--palette-warn": "#FCD34D",
    "--palette-text-bright": "#FFFFFF",
    "--palette-text-normal": "#E5E7EB",
    "--palette-text-muted": "#9CA3AF",
    "--palette-text-dim": "#6B7280",
  },
};

export async function loadThemes(): Promise<Theme[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}themes.json`);
    if (!res.ok) return [FALLBACK];
    const data: Theme[] = await res.json();
    return data.length > 0 ? data : [FALLBACK];
  } catch {
    return [FALLBACK];
  }
}

// The browser-tab favicon is the static Meshat brand mark (public/favicon.svg, linked from
// index.html) — deliberately not theme-driven, so the tab always shows the brand.
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, value);
  }
}
