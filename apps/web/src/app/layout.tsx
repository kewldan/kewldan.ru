import type { Metadata, Viewport } from "next";
import { Geist, Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { getContent } from "@/lib/api/content";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  axes: ["wdth"],
});
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { profile } = await getContent();
  const title = `${profile.shortName} (${profile.handle}): full-stack & systems developer`;
  return {
    metadataBase: new URL(profile.siteUrl),
    title: { default: title, template: `%s · ${profile.handle}` },
    description: profile.description,
    authors: [{ name: profile.name, url: profile.siteUrl }],
    openGraph: { type: "website", title, description: profile.description, siteName: profile.handle },
    twitter: { card: "summary_large_image", creator: `@${profile.handle}` },
  };
}

export const viewport: Viewport = {
  themeColor: "#0d0d0f",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${geist.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
