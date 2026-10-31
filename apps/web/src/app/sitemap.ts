import type { MetadataRoute } from "next";

import { getContent } from "@/lib/api/content";
import { LANGS, localize } from "@/lib/i18n";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { profile, work } = await getContent();
  const url = (path: string) => new URL(path, profile.siteUrl).toString();
  type Page = [string, MetadataRoute.Sitemap[number]["changeFrequency"], number];
  const pages: Page[] = [
    ["/", "weekly", 1],
    ...work.projects.filter((p) => p.case).map((p): Page => [`/work/${p.id}`, "monthly", 0.8]),
    ["/watched", "weekly", 0.5],
  ];
  // Every page in both languages, each pointing at its twin.
  return pages.flatMap(([path, changeFrequency, priority]) =>
    LANGS.map((lang) => ({
      url: url(localize(lang, path)),
      changeFrequency,
      priority,
      alternates: { languages: Object.fromEntries(LANGS.map((l) => [l, url(localize(l, path))])) },
    })),
  );
}
