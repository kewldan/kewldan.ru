import type { MetadataRoute } from "next";

import { getContent } from "@/lib/api/content";

/** Search engines and AI assistants, named so the welcome is explicit. */
const AI = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "YandexAdditional",
  "meta-externalagent",
  "CCBot",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { profile } = await getContent();
  const closed = ["/api/", "/admin"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: closed },
      { userAgent: AI, allow: "/", disallow: closed },
    ],
    sitemap: new URL("/sitemap.xml", profile.siteUrl).toString(),
    host: profile.siteUrl,
  };
}
