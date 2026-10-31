import type { MetadataRoute } from "next";

import { getContent } from "@/lib/api/content";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { profile, work } = await getContent();
  const url = (path: string) => new URL(path, profile.siteUrl).toString();
  return [
    { url: url("/"), changeFrequency: "weekly", priority: 1 },
    { url: url("/ru"), changeFrequency: "monthly", priority: 0.9 },
    ...work.projects
      .filter((p) => p.case)
      .map((p) => ({ url: url(`/work/${p.id}`), changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: url("/watched"), changeFrequency: "weekly", priority: 0.5 },
  ];
}
