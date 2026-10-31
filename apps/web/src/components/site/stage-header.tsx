"use client";

import Link from "next/link";

import { useI18n } from "@/components/lang";
import { LangSwitch } from "@/components/site/lang-switch";
import { Switches } from "@/components/site/switches";

/** The slim top bar of the keynote pages: handle on the left, the way home on the right. */
export function StageHeader({ handle }: { handle: string }) {
  const { t, href } = useI18n();
  return (
    <header className="border-b border-stage-rule">
      <div className="wrap flex items-center justify-between gap-3 py-3 text-sm">
        <Link href={href("/")} className="text-[15px] font-semibold">
          {handle}
        </Link>
        <div className="flex items-center gap-1.5">
          <LangSwitch tone="stage" />
          <Switches tone="stage" />
          <Link href={href("/")} className="ml-2 py-2 text-stage-chip transition-colors hover:text-stage-fg">
            {t.nav.backHome}
          </Link>
        </div>
      </div>
    </header>
  );
}
