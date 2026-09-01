import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

export const LANGUAGE_STORAGE_KEY = "beacon-language";
// Swedish is the app's default language. Visitors opt into other languages via the picker; an
// explicit choice is persisted and always wins over the default.
const DEFAULT_LANGUAGE = "sv";

interface TranslationFile {
  _meta: {
    name: string;
    direction?: "ltr" | "rtl";
  };
  [key: string]: unknown;
}

interface LocaleModule {
  default: TranslationFile;
}

export interface AvailableLanguage {
  code: string;
  name: string;
  direction: "ltr" | "rtl";
}

// Vite turns every matching JSON file into a bundled resource. Contributors only need to add
// locales/<language-tag>/translation.json; no central language registry needs updating.
const localeModules = import.meta.glob<LocaleModule>("./locales/*/translation.json", {
  eager: true,
});

const resources: Record<string, { translation: TranslationFile }> = {};

export const availableLanguages: AvailableLanguage[] = Object.entries(localeModules)
  .map(([path, module]) => {
    const code = path.match(/\.\/locales\/([^/]+)\/translation\.json$/)?.[1];
    if (!code || !module.default?._meta?.name) {
      throw new Error(`Invalid locale module: ${path}`);
    }

    resources[code] = { translation: module.default };
    return {
      code,
      name: module.default._meta.name,
      direction: module.default._meta.direction ?? "ltr",
    };
  })
  .sort((a, b) => {
    if (a.code === DEFAULT_LANGUAGE) return -1;
    if (b.code === DEFAULT_LANGUAGE) return 1;
    return a.name.localeCompare(b.name);
  });

function supportedLanguage(language: string | null | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = language.replace("_", "-");
  return availableLanguages.find(({ code }) =>
    normalized.toLowerCase() === code.toLowerCase()
      || normalized.toLowerCase().startsWith(`${code.toLowerCase()}-`),
  )?.code;
}

function storage(): Storage | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    // Storage can be disabled by browser privacy settings or unavailable in SSR/test environments.
    return undefined;
  }
}

export function detectLanguage(): string {
  return supportedLanguage(storage()?.getItem(LANGUAGE_STORAGE_KEY)) ?? DEFAULT_LANGUAGE;
}

function updateDocumentLanguage(language: string) {
  if (typeof document === "undefined") return;
  const selected = availableLanguages.find(({ code }) => code === language);
  document.documentElement.lang = selected?.code ?? DEFAULT_LANGUAGE;
  document.documentElement.dir = selected?.direction ?? "ltr";
}

void i18n
  .use(initReactI18next)
  .init({
    resources: resources as Resource,
    lng: detectLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: availableLanguages.map(({ code }) => code),
    // detectLanguage already maps regional browser tags to an available locale. Keep an exact
    // locale such as pt-BR intact instead of truncating it to pt here.
    load: "currentOnly",
    interpolation: { escapeValue: false },
    initAsync: false,
  });

updateDocumentLanguage(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE);

i18n.on("languageChanged", (language) => {
  const supported = supportedLanguage(language) ?? DEFAULT_LANGUAGE;
  storage()?.setItem(LANGUAGE_STORAGE_KEY, supported);
  updateDocumentLanguage(supported);
});

export default i18n;
