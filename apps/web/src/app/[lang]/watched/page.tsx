import type { Metadata } from "next";
import { Suspense } from "react";

import { StageHeader } from "@/components/site/stage-header";
import { WatchedView } from "@/components/watched/watched-view";
import { getContent } from "@/lib/api/content";
import { getWatched } from "@/lib/api/watched";
import { alternates, langOf } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]/watched">): Promise<Metadata> {
  const lang = langOf(await params);
  const { watched } = await getContent(lang);
  return {
    title: watched.title.replace(/\.$/, ""),
    description: watched.description,
    alternates: alternates(lang, "/watched"),
  };
}

export default async function WatchedPage({ params }: PageProps<"/[lang]/watched">) {
  const { profile } = await getContent();
  return (
    <div data-surface="stage" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <StageHeader handle={profile.handle} />
      <Suspense fallback={<div className="min-h-dvh" />}>
        <List params={params} />
      </Suspense>
    </div>
  );
}

async function List({ params }: Pick<PageProps<"/[lang]/watched">, "params">) {
  const [{ watched }, initial] = await Promise.all([getContent(langOf(await params)), getWatched()]);
  return <WatchedView page={watched} initial={initial} />;
}
