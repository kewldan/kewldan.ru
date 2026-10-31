"use client";

import { createContext, use } from "react";

import { copy, plural as pluralFor, type Plural } from "@/lib/copy";
import { type Lang, localize } from "@/lib/i18n";

const LangContext = createContext<Lang>("en");

/** The page's language, for every client component below it. */
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext value={lang}>{children}</LangContext>;
}

export const useLang = () => use(LangContext);

/** Interface strings in the page's language. */
export const useT = () => copy[useLang()];

/** `plural` and `localize` bound to the page's language. */
export function useI18n() {
  const lang = useLang();
  return {
    lang,
    t: copy[lang],
    plural: (n: number, forms: Plural) => pluralFor(n, forms, lang),
    href: (path: string) => localize(lang, path),
  };
}
