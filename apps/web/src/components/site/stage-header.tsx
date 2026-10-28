import Link from "next/link";

import { Switches } from "@/components/site/switches";
import { t } from "@/lib/copy";

/** The slim top bar of the keynote pages: handle on the left, the way home on the right. */
export function StageHeader({ handle }: { handle: string }) {
  return (
    <header className="border-b border-stage-rule">
      <div className="wrap flex items-center justify-between gap-3 py-3 text-sm">
        <Link href="/" className="text-[15px] font-semibold">
          {handle}
        </Link>
        <div className="flex items-center gap-1.5">
          <Switches tone="stage" />
          <Link href="/" className="ml-2 py-2 text-stage-chip transition-colors hover:text-stage-fg">
            {t.nav.backHome}
          </Link>
        </div>
      </div>
    </header>
  );
}
