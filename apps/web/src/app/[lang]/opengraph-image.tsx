import { ImageResponse } from "next/og";

import { getContent } from "@/lib/api/content";
import { langOf } from "@/lib/i18n";
import { HomeCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "kewldan.ru";

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const lang = langOf(await params);
  const content = await getContent(lang);
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<HomeCard content={content} domain={domain} />, { ...size, fonts: await ogFonts() });
}
