import { ImageResponse } from "next/og";

import { getContent } from "@/lib/api/content";
import { langOf } from "@/lib/i18n";
import { CaseCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Case study · kewldan.ru";

export async function generateStaticParams() {
  const { work } = await getContent();
  return work.projects.filter((p) => p.case).map((p) => ({ id: p.id }));
}

export default async function Image({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { id, ...rest } = await params;
  const lang = langOf(rest);
  const content = await getContent(lang);
  const project = content.work.projects.find((p) => p.id === id && p.case) ?? content.work.projects[0];
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<CaseCard project={project} handle={content.profile.handle} domain={domain} lang={lang} />, {
    ...size,
    fonts: await ogFonts(),
  });
}
