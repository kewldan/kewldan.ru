export const locales = ["en", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/**
 * The language switch is hidden for now and every visitor gets English.
 * Flip to true to bring back /ru, the switch and browser-language detection.
 */
export const LANGUAGE_SWITCH = false;
export const publicLocales: readonly Locale[] = LANGUAGE_SWITCH ? locales : [defaultLocale];
export const LOCALE_COOKIE = "locale";

export const hasLocale = (value: string): value is Locale => (locales as readonly string[]).includes(value);

/** Apple emoji flags, served through /emoji (see next.config.ts). */
export const localeMeta: Record<Locale, { name: string; flag: string; emoji: string; intl: string }> = {
  en: { name: "English", flag: "1f1ec-1f1e7", emoji: "🇬🇧", intl: "en-US" },
  ru: { name: "Русский", flag: "1f1f7-1f1fa", emoji: "🇷🇺", intl: "ru-RU" },
};

/** Plural forms as Intl.PluralRules names them; Russian uses one/few/many. */
export type Plural = { one: string; few?: string; many?: string; other: string };

export function plural(locale: Locale, n: number, forms: Plural) {
  const rule = new Intl.PluralRules(localeMeta[locale].intl).select(n) as keyof Plural;
  return (forms[rule] ?? forms.other).replace("{n}", n.toLocaleString(localeMeta[locale].intl));
}
