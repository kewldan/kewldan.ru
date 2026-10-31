"use client";

import { usePathname } from "next/navigation";

import { useLang } from "@/components/lang";
import { type Lang, langName, localize, unlocalize } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { type Tone, trigger } from "./switches";

/**
 * The same page in the other language: "RU" on the English site, "EN" on
 * the Russian one. A plain link, so the page loads afresh: a client-side
 * hop would keep the old language's page hidden in the DOM, with its ids,
 * canvases and sockets, and the animations would trip over the twin.
 */
export function LangSwitch({ tone = "paper" }: { tone?: Tone }) {
  const lang = useLang();
  const other: Lang = lang === "en" ? "ru" : "en";
  const path = unlocalize(usePathname() ?? "/");
  return (
    <a
      href={localize(other, path)}
      hrefLang={other}
      lang={other}
      aria-label={langName[other]}
      title={langName[other]}
      className={cn(
        "inline-flex items-center justify-center font-mono text-[13px] font-bold tracking-wide uppercase",
        tone === "paper" ? "w-11" : "w-10",
        trigger[tone],
      )}
    >
      {other}
    </a>
  );
}
