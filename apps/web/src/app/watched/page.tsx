import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { WatchedView } from "@/components/watched/watched-view";
import { getContent } from "@/lib/api/content";
import { getWatched } from "@/lib/api/watched";

export async function generateMetadata(): Promise<Metadata> {
  const { watched } = await getContent();
  return { title: "Watched", description: watched.description };
}

export default async function WatchedPage() {
  const { watched, profile } = await getContent();
  return (
    <div data-surface="stage" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <header className="border-b border-stage-rule">
        <div className="wrap flex items-center justify-between gap-3 py-3 text-sm">
          <b className="text-[15px] font-semibold">{profile.handle}</b>
          <Link href="/" className="py-2 text-stage-chip transition-colors hover:text-white">
            ← kewldan.ru
          </Link>
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
