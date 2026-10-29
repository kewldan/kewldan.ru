import type { MetadataRoute } from "next";

import { getContent } from "@/lib/api/content";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { profile } = await getContent();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] },
    sitemap: new URL("/sitemap.xml", profile.siteUrl).toString(),
    host: profile.siteUrl,
  };
}
