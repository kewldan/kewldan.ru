import { ImageResponse } from "next/og";

import { getContent } from "@/lib/api/content";
import { langOf } from "@/lib/i18n";
import { WatchedCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Watched · kewldan.ru";

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const lang = langOf(await params);
  const content = await getContent(lang);
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<WatchedCard content={content} domain={domain} />, { ...size, fonts: await ogFonts() });
}
