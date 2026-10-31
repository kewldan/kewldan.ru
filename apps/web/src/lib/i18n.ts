/** The site's languages: English at the root, Russian under `/ru`. */
export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];

export const isLang = (s: string): s is Lang => (LANGS as readonly string[]).includes(s);

/** The language from a route's params; English for anything unknown. */
export const langOf = ({ lang }: { lang: string }): Lang => (isLang(lang) ? lang : "en");

/** For `Intl` and `toLocaleString`. */
export const locale: Record<Lang, string> = { en: "en-US", ru: "ru-RU" };
/** For Open Graph. */
export const ogLocale: Record<Lang, string> = { en: "en_US", ru: "ru_RU" };
/** The language's own name, for the switch. */
export const langName: Record<Lang, string> = { en: "English", ru: "Русский" };

/**
 * A site path in `lang`: `/watched` stays as is in English and becomes
 * `/ru/watched` in Russian; anchors and other sites pass through.
 */
export function localize(lang: Lang, href: string) {
  if (lang === "en" || !href.startsWith("/") || href.startsWith("//")) return href;
  if (href === "/") return "/ru";
  if (href.startsWith("/#")) return `/ru${href.slice(1)}`;
  return `/ru${href}`;
}

/** The path without its language: `/ru/work/x` → `/work/x`. */
export function unlocalize(path: string) {
  if (path === "/ru") return "/";
  return path.startsWith("/ru/") ? path.slice(3) : path;
}

/** Canonical and hreflang links for a page at `path` (as in English). */
export function alternates(lang: Lang, path: string) {
  return {
    canonical: localize(lang, path),
    languages: { en: path, ru: localize("ru", path), "x-default": path },
  };
}
