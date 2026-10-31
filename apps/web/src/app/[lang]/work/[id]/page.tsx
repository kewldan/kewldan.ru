import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CaseView } from "@/components/case/case-view";
import { JsonLd, person } from "@/components/json-ld";
import { plainRich } from "@/components/rich";
import { StageHeader } from "@/components/site/stage-header";
import { getContent } from "@/lib/api/content";
import { copy } from "@/lib/copy";
import { alternates, type Lang, langOf, localize, ogLocale } from "@/lib/i18n";

/** The projects with a case study, in slide order. */
async function cases(lang: Lang = "en") {
  const { work } = await getContent(lang);
  return work.projects.filter((p) => p.case);
}

export async function generateStaticParams() {
  return (await cases()).map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/work/[id]">): Promise<Metadata> {
  const { id, ...rest } = await params;
  const lang = langOf(rest);
  const p = (await cases(lang)).find((p) => p.id === id);
  if (!p) return {};
  const title = `${p.name}: ${copy[lang].case.eyebrow.toLowerCase()}`;
  const description = plainRich(p.case!.summary);
  return {
    title,
    description,
    alternates: alternates(lang, `/work/${p.id}`),
    openGraph: { type: "article", title, description, url: localize(lang, `/work/${p.id}`), locale: ogLocale[lang] },
  };
}

export default async function CasePage({ params }: PageProps<"/[lang]/work/[id]">) {
  // The handle is the same in every language; params are read inside the
  // Suspense boundary, so the shell stays instant.
  const { profile } = await getContent();
  return (
    <div data-surface="stage" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <StageHeader handle={profile.handle} />
      <Suspense fallback={<div className="min-h-dvh" />}>
        <Case params={params} />
      </Suspense>
    </div>
  );
}

async function Case({ params }: Pick<PageProps<"/[lang]/work/[id]">, "params">) {
  const { id, ...rest } = await params;
  const lang = langOf(rest);
  const [all, content] = await Promise.all([cases(lang), getContent(lang)]);
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) notFound();
  const next = all.length > 1 ? all[(index + 1) % all.length] : null;
  const p = all[index];
  const url = new URL(localize(lang, `/work/${p.id}`), content.profile.siteUrl).toString();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Article",
              headline: `${p.name}: ${p.title} ${p.titleDim}`,
              description: plainRich(p.case!.summary),
              url,
              mainEntityOfPage: url,
              inLanguage: lang,
              image: `${url}/opengraph-image`,
              author: person(content),
              about: { "@type": "SoftwareApplication", name: p.name, applicationCategory: "DeveloperApplication" },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: content.profile.name,
                  item: new URL(localize(lang, "/"), content.profile.siteUrl).toString(),
                },
                { "@type": "ListItem", position: 2, name: p.name, item: url },
              ],
            },
          ],
        }}
      />
      <CaseView project={p} next={next} lang={lang} />
    </>
  );
}
