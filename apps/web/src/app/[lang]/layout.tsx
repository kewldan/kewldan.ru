import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";

import { LangProvider } from "@/components/lang";
import { Providers } from "@/components/providers";
import { CommandPalette } from "@/components/site/command-palette";
import { Konami } from "@/components/site/konami";
import { getContent } from "@/lib/api/content";
import { fontVariables } from "@/lib/fonts";
import { isLang, LANGS, localize, ogLocale } from "@/lib/i18n";
import { themeScript } from "@/lib/theme";
import "../globals.css";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const { profile } = await getContent(lang);
  // The full name first: that is what people search for.
  const title = `${profile.name} (${profile.handle}): ${profile.role}`;
  return {
    metadataBase: new URL(profile.siteUrl),
    title: { default: title, template: `%s · ${profile.name}` },
    description: profile.description,
    applicationName: profile.handle,
    authors: [{ name: profile.name, url: profile.siteUrl }],
    creator: profile.name,
    // The same, written for language models: /llms.txt.
    alternates: { types: { "text/markdown": "/llms.txt" } },
    openGraph: {
      type: "website",
      title,
      description: profile.description,
      siteName: `${profile.name} (${profile.handle})`,
      locale: ogLocale[lang],
      alternateLocale: LANGS.filter((l) => l !== lang).map((l) => ogLocale[l]),
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

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const { nav, work, contact } = await getContent(lang);
  return (
    <html lang={lang} suppressHydrationWarning className={fontVariables}>
      <body>
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <Script src="/insights.js" strategy="afterInteractive" />
        <LangProvider lang={lang}>
          <Providers>
            {children}
            <CommandPalette
              sections={nav.map((l) => ({ ...l, href: localize(lang, l.href) }))}
              cases={work.projects
                .filter((p) => p.case && !p.hidden)
                .map((p) => ({ id: p.id, name: p.name, title: p.title }))}
              socials={contact.socials}
            />
            <Konami />
          </Providers>
        </LangProvider>
      </body>
    </html>
  );
}
