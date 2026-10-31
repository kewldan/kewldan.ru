import { type Lang, locale } from "@/lib/i18n";

import { type Copy, en, type Plural } from "./en";
import { ru } from "./ru";

export type { Copy, Plural } from "./en";

/** Interface strings by language. Client components read theirs with `useT()`. */
export const copy: Record<Lang, Copy> = { en, ru };

/** `"{n} of {max}"` style substitution. */
export const fmt = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

/** The form of a word for `n` by the language's plural rules, with `{n}` filled in. */
export const plural = (n: number, forms: Plural, lang: Lang) => {
  const rule = new Intl.PluralRules(locale[lang]).select(n) as keyof typeof forms;
  return (forms[rule] ?? forms.other).replace("{n}", n.toLocaleString(locale[lang]));
};
