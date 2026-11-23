import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import chatEn from "./locales/en/chat.json";
import commonEn from "./locales/en/common.json";
import governanceEn from "./locales/en/governance.json";
import officeEn from "./locales/en/office.json";
import researchEn from "./locales/en/research.json";
import settingsEn from "./locales/en/settings.json";

type StringMap = Record<string, string>;

type PrefixKeys<P extends string, T extends StringMap> = {
  [K in keyof T & string as `${P}.${K}`]: string;
};

function prefix<P extends string, T extends StringMap>(ns: P, dict: T): PrefixKeys<P, T> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict)) out[`${ns}.${k}`] = v;
  return out as PrefixKeys<P, T>;
}

export const EN_MESSAGES = {
  ...prefix("common", commonEn),
  ...prefix("office", officeEn),
  ...prefix("governance", governanceEn),
  ...prefix("chat", chatEn),
  ...prefix("research", researchEn),
  ...prefix("settings", settingsEn),
};

export type Locale = "en";
export type MessageKey = keyof typeof EN_MESSAGES;
export type MessageVars = Record<string, string | number>;

const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: EN_MESSAGES,
};

export function normalizeLocale(raw?: string | null): Locale {
  if (!raw) return "en";
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return base === "en" ? "en" : "en";
}

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

export function t(key: MessageKey, vars?: MessageVars, locale: Locale = "en"): string {
  const catalog = CATALOGS[locale] ?? EN_MESSAGES;
  const template = catalog[key] ?? EN_MESSAGES[key] ?? String(key);
  return interpolate(template, vars);
}

export interface I18nContextValue {
  locale: Locale;
  t: (key: MessageKey, vars?: MessageVars) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "en",
  t: (key, vars) => t(key, vars, "en"),
});

export function I18nProvider({ locale = "en", children }: { locale?: string | null; children: ReactNode }) {
  const resolved = normalizeLocale(locale);
  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);
  const value = useMemo<I18nContextValue>(
    () => ({
      locale: resolved,
      t: (key, vars) => t(key, vars, resolved),
    }),
    [resolved],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
