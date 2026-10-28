import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Switches } from "@/components/site/switches";
import { WatchedView } from "@/components/watched/watched-view";
import { hasLocale } from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionaries";
import { getContent } from "@/lib/api/content";
import { getWatched } from "@/lib/api/watched";

export async function generateMetadata({ params }: PageProps<"/[locale]/watched">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locale)) return {};
  const { watched } = await getContent(locale);
  return { title: watched.title.replace(/\.$/, ""), description: watched.description };
}

export default async function WatchedPage({ params }: PageProps<"/[locale]/watched">) {
  const { locale } = await params;
  if (!hasLocale(locale)) notFound();
  const { watched, profile } = await getContent(locale);
  const t = dictionaries[locale];
  return (
    <div data-surface="stage" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <header className="border-b border-stage-rule">
        <div className="wrap flex items-center justify-between gap-3 py-3 text-sm">
          <b className="text-[15px] font-semibold">{profile.handle}</b>
          <div className="flex items-center gap-1.5">
            <Switches tone="stage" />
            <Link href={`/${locale}`} className="ml-2 py-2 text-stage-chip transition-colors hover:text-stage-fg">
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
