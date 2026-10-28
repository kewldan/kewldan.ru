import { ImageResponse } from "next/og";

import { getContent } from "@/lib/api/content";
import { CaseCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Case study · kewldan.ru";

export async function generateStaticParams() {
  const { work } = await getContent();
  return work.projects.filter((p) => p.case).map((p) => ({ id: p.id }));
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const content = await getContent();
  const project = content.work.projects.find((p) => p.id === id && p.case) ?? content.work.projects[0];
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<CaseCard project={project} handle={content.profile.handle} domain={domain} />, {
    ...size,
    fonts: await ogFonts(),
  });
}
