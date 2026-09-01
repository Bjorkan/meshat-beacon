import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageSelector } from "../src/components/LanguageSelector";
import i18n, { availableLanguages, detectLanguage, LANGUAGE_STORAGE_KEY } from "../src/i18n";
import english from "../src/locales/en/translation.json";
import swedish from "../src/locales/sv/translation.json";

function translationKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child != null && typeof child === "object"
      ? translationKeys(child as object, path)
      : [path];
  });
}

describe("internationalization", () => {
  const values = new Map<string, string>();

  beforeEach(async () => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    await act(() => i18n.changeLanguage("en"));
  });

  afterEach(async () => {
    await act(() => i18n.changeLanguage("en"));
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    vi.unstubAllGlobals();
  });

  it("discovers bundled locale files without a hand-maintained registry", () => {
    expect(availableLanguages).toEqual([
      { code: "sv", name: "Svenska", direction: "ltr" },
      { code: "en", name: "English", direction: "ltr" },
    ]);
  });

  it("defaults to Swedish when no language has been chosen", () => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    expect(detectLanguage()).toBe("sv");
  });

  it("keeps the Swedish catalog aligned with the English source catalog", () => {
    expect(translationKeys(swedish).sort()).toEqual(translationKeys(english).sort());
  });

  it("preserves established MeshCore terms in translated sentences", () => {
    expect(swedish.observers.advertsHeard).toContain("adverts");
    expect(swedish.stats.repeatersOutOfSync).toContain("Repeaters");
    expect(swedish.stats.repeatersOutOfSync).toContain("room servers");
    expect(swedish.navigation.tabs.traces).toBe("Traces");
    expect(swedish.stats.payloadTypes).toContain("Payload");
  });

  it("switches language, persists the choice, and updates the document language", async () => {
    render(<LanguageSelector />);

    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    fireEvent.click(screen.getByRole("button", { name: "Svenska" }));

    expect(await screen.findByRole("button", { name: "Språk: Svenska" })).toBeInTheDocument();
    expect(i18n.resolvedLanguage).toBe("sv");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("sv");
    expect(document.documentElement).toHaveAttribute("lang", "sv");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
  });
});
