import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import Script from "next/script";

import { fontVariables } from "@/lib/fonts";
import { themeScript } from "@/lib/theme";
import "../globals.css";
import "./admin.css";

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/** Its own root layout: the site's lives under `[lang]`, and the admin is English only. */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fontVariables} ${schibsted.variable}`}>
      <body>
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
