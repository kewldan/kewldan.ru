import Link from "next/link";

import type { Footer as FooterContent } from "@/lib/api/generated/Footer";
import type { Russian } from "@/lib/api/generated/Russian";
import { t } from "@/lib/copy";

export function SiteFooter({ footer, ru }: { footer: FooterContent; ru: Russian }) {
  return (
    <footer className="border-t border-stage-rule bg-stage font-stage text-[12.5px] text-stage-dim">
      <div className="wrap flex flex-wrap justify-between gap-3 py-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <span>{footer.copyright}</span>
        <span>{footer.thanks}</span>
        <kbd className="hidden font-stage md:inline">{t.palette.hint}</kbd>
        <span className="flex gap-4">
          <Link href="/ru" lang="ru" hrefLang="ru" className="text-stage-chip hover:text-white">
            {ru.link}
          </Link>
          <a href={footer.source.href} className="text-stage-chip hover:text-white">
            {footer.source.label}
          </a>
        </span>
      </div>
    </footer>
  );
}
