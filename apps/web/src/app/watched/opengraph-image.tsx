import { ImageResponse } from "next/og";

import { getContent } from "@/lib/api/content";
import { WatchedCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Watched · kewldan.ru";

export default async function Image() {
  const content = await getContent();
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<WatchedCard content={content} domain={domain} />, { ...size, fonts: await ogFonts() });
}
