import { useTranslation } from "react-i18next";
import { availableLanguages } from "../i18n";
import { Dropdown } from "./Dropdown";

export function LanguageSelector() {
  const { t, i18n } = useTranslation();
  const currentCode = i18n.resolvedLanguage ?? i18n.language;
  const current = availableLanguages.find(({ code }) => code === currentCode) ?? availableLanguages[0]!;

  return (
    <Dropdown
      width="w-40"
      renderTrigger={({ toggle }) => (
        <button
          type="button"
          aria-label={t("language.current", { name: current.name })}
          title={t("language.current", { name: current.name })}
          className="flex items-center gap-1.5 bg-bg-raised border border-border rounded px-2 py-1 text-text-muted font-mono text-[11px] hover:text-text-normal hover:border-text-dim transition-colors"
          onClick={toggle}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21M12 3C9.6 5.5 8.3 8.5 8.3 12s1.3 6.5 3.7 9" />
          </svg>
          <span className="uppercase">{current.code}</span>
          <span className="text-text-dim">▾</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wide text-text-dim">
            {t("language.label")}
          </div>
          {availableLanguages.map((language) => (
            <button
              key={language.code}
              type="button"
              lang={language.code}
              aria-label={language.name}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono transition-colors ${
                language.code === current.code
                  ? "text-text-bright bg-primary/10"
                  : "text-text-muted hover:text-text-normal hover:bg-text-normal/3"
              }`}
              onClick={() => {
                void i18n.changeLanguage(language.code);
                close();
              }}
            >
              <span className="w-5 uppercase text-primary">{language.code}</span>
              <span>{language.name}</span>
            </button>
          ))}
        </>
      )}
    </Dropdown>
  );
}
