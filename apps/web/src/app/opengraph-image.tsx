import { ImageResponse } from "next/og";

import { getContent } from "@/lib/api/content";
import { HomeCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "kewldan.ru";

export default async function Image() {
  const content = await getContent();
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<HomeCard content={content} domain={domain} />, { ...size, fonts: await ogFonts() });
}
