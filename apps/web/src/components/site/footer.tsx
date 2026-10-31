import Link from "next/link";

import type { Footer as FooterContent } from "@/lib/api/generated/Footer";
import { copy } from "@/lib/copy";
import { type Lang, langName, localize } from "@/lib/i18n";

export function SiteFooter({ footer, lang }: { footer: FooterContent; lang: Lang }) {
  const other: Lang = lang === "en" ? "ru" : "en";
  return (
    <footer className="border-t border-stage-rule bg-stage font-stage text-[12.5px] text-stage-dim">
      <div className="wrap flex flex-wrap justify-between gap-3 py-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <span>{footer.copyright}</span>
        <span>{footer.thanks}</span>
        <kbd className="hidden font-stage md:inline">{copy[lang].palette.hint}</kbd>
        <span className="flex gap-4">
          <Link href={localize(other, "/")} lang={other} hrefLang={other} className="text-stage-chip hover:text-white">
            {langName[other]}
          </Link>
          <a href={footer.source.href} className="text-stage-chip hover:text-white">
            {footer.source.label}
          </a>
        </span>
      </div>
    </footer>
  );
}
