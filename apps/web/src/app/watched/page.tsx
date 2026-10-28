import type { Metadata } from "next";
import { Suspense } from "react";

import { StageHeader } from "@/components/site/stage-header";
import { WatchedView } from "@/components/watched/watched-view";
import { getContent } from "@/lib/api/content";
import { getWatched } from "@/lib/api/watched";

export async function generateMetadata(): Promise<Metadata> {
  const { watched } = await getContent();
  return {
    title: watched.title.replace(/\.$/, ""),
    description: watched.description,
    alternates: { canonical: "/watched" },
  };
}

export default async function WatchedPage() {
  const { watched, profile } = await getContent();
  return (
    <div data-surface="stage" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <StageHeader handle={profile.handle} />
      <Suspense fallback={<div className="min-h-dvh" />}>
        <List page={watched} />
      </Suspense>
    </div>
  );
}

async function List({ page }: { page: Awaited<ReturnType<typeof getContent>>["watched"] }) {
  return <WatchedView page={page} initial={await getWatched()} />;
}
