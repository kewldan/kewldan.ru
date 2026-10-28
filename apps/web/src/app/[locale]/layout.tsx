import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist, Instrument_Sans, Instrument_Serif, JetBrains_Mono, Onest } from "next/font/google";
import { notFound } from "next/navigation";
import Script from "next/script";

import { Providers } from "@/components/providers";
import { hasLocale, locales, publicLocales } from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionaries";
import { getContent } from "@/lib/api/content";
import { themeScript } from "@/lib/theme";
import "../globals.css";

const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"], axes: ["wdth"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});
// Instrument has no Cyrillic: these take over glyph by glyph for Russian.
const onest = Onest({ variable: "--font-onest", subsets: ["cyrillic"] });
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["cyrillic"],
  weight: "500",
  style: "italic",
});
const geist = Geist({ variable: "--font-geist", subsets: ["latin", "cyrillic"] });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700"],
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locale)) return {};
  const { profile } = await getContent(locale);
  const title = `${profile.shortName} (${profile.handle}): ${profile.role}`;
  return {
    metadataBase: new URL(profile.siteUrl),
    title: { default: title, template: `%s · ${profile.handle}` },
    description: profile.description,
    authors: [{ name: profile.name, url: profile.siteUrl }],
    alternates:
      publicLocales.length > 1 ? { languages: Object.fromEntries(publicLocales.map((l) => [l, `/${l}`])) } : undefined,
    openGraph: {
      type: "website",
      title,
      description: profile.description,
      siteName: profile.handle,
      locale: locale === "ru" ? "ru_RU" : "en_US",
    },
    twitter: { card: "summary_large_image", creator: `@${profile.handle}` },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(locale)) notFound();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={[instrumentSans, instrumentSerif, onest, cormorant, geist, jetbrainsMono]
        .map((f) => f.variable)
        .join(" ")}
    >
      <body>
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <Providers locale={locale} t={dictionaries[locale]}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
