"use client";

import { createContext, useContext } from "react";

import { type Locale, localeMeta, plural } from "./config";
import type { Dictionary } from "./dictionaries/en";

type I18n = { locale: Locale; t: Dictionary };

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, t, children }: I18n & { children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  const intl = localeMeta[ctx.locale].intl;
  return {
    ...ctx,
    intl,
    /** "{n} of {max}" style substitution. */
    fmt: (s: string, vars: Record<string, string | number>) =>
      s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)),
    plural: (n: number, forms: Parameters<typeof plural>[2]) => plural(ctx.locale, n, forms),
  };
}
