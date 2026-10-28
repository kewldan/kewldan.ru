import { ImageResponse } from "next/og";

import { hasLocale, locales } from "@/i18n/config";
import { getContent } from "@/lib/api/content";
import { WatchedCard } from "@/og/card";
import { ogFonts, ogSize } from "@/og/fonts";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Watched · kewldan.ru";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const content = await getContent(hasLocale(locale) ? locale : "en");
  const domain = new URL(content.profile.siteUrl).host;
  return new ImageResponse(<WatchedCard content={content} domain={domain} />, { ...size, fonts: await ogFonts() });
}
