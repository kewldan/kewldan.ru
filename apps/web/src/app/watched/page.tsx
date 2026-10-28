import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Switches } from "@/components/site/switches";
import { WatchedView } from "@/components/watched/watched-view";
import { getContent } from "@/lib/api/content";
import { t } from "@/lib/copy";
import { getWatched } from "@/lib/api/watched";

export async function generateMetadata(): Promise<Metadata> {
  const { watched } = await getContent();
  return { title: watched.title.replace(/\.$/, ""), description: watched.description };
}

export default async function WatchedPage() {
  const { watched, profile } = await getContent();
  return (
    <div data-surface="stage" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <header className="border-b border-stage-rule">
        <div className="wrap flex items-center justify-between gap-3 py-3 text-sm">
          <b className="text-[15px] font-semibold">{profile.handle}</b>
          <div className="flex items-center gap-1.5">
            <Switches tone="stage" />
            <Link href="/" className="ml-2 py-2 text-stage-chip transition-colors hover:text-stage-fg">
              {t.nav.backHome}
            </Link>
          </div>
        </div>
      </header>
      <Suspense fallback={<div className="min-h-dvh" />}>
        <List page={watched} />
      </Suspense>
    </div>
  );
}

async function List({ page }: { page: Awaited<ReturnType<typeof getContent>>["watched"] }) {
  return <WatchedView page={page} initial={await getWatched()} />;
}
