import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CaseView } from "@/components/case/case-view";
import { JsonLd, person } from "@/components/json-ld";
import { plainRich } from "@/components/rich";
import { StageHeader } from "@/components/site/stage-header";
import { getContent } from "@/lib/api/content";
import { t } from "@/lib/copy";

/** The projects with a case study, in slide order. */
async function cases() {
  const { work } = await getContent();
  return work.projects.filter((p) => p.case);
}

export async function generateStaticParams() {
  return (await cases()).map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: PageProps<"/work/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = (await cases()).find((p) => p.id === id);
  if (!p) return {};
  const title = `${p.name}: ${t.case.eyebrow.toLowerCase()}`;
  const description = plainRich(p.case!.summary);
  return {
    title,
    description,
    alternates: { canonical: `/work/${p.id}` },
    openGraph: { type: "article", title, description, url: `/work/${p.id}` },
  };
}

export default async function CasePage({ params }: PageProps<"/work/[id]">) {
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

async function Case({ params }: Pick<PageProps<"/work/[id]">, "params">) {
  const { id } = await params;
  const [all, content] = await Promise.all([cases(), getContent()]);
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) notFound();
  const next = all.length > 1 ? all[(index + 1) % all.length] : null;
  const p = all[index];
  const url = new URL(`/work/${p.id}`, content.profile.siteUrl).toString();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: `${p.name}: ${p.title} ${p.titleDim}`,
          description: plainRich(p.case!.summary),
          url,
          mainEntityOfPage: url,
          image: `${url}/opengraph-image`,
          author: person(content),
          about: { "@type": "SoftwareApplication", name: p.name, applicationCategory: "DeveloperApplication" },
        }}
      />
      <CaseView project={p} next={next} />
    </>
  );
}
