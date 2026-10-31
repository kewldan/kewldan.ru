import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import bundledEn from "../../../../api/content/en.json";
import bundledRu from "../../../../api/content/ru.json";
import bundledStats from "../../../../api/content/stats.json";
import { type Lang, locale } from "@/lib/i18n";

import type { Content } from "./generated/Content";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const TIMEOUT_MS = 2500;

/** The API fills `{gh.*}` / `{steam.*}`; the bundled copy needs the same. */
function fillStats(value: unknown, lang: Lang): Content {
  const stats = bundledStats as Record<string, number>;
  const json = JSON.stringify(value).replace(/\{((?:gh|steam)\.[a-z0-9_.]+)\}/g, (m, key: string) =>
    key in stats ? stats[key].toLocaleString(locale[lang]) : m,
  );
  return JSON.parse(json) as Content;
}

/**
 * Site content in `lang` from the Rust API, cached for a minute and shared by every
 * request. When the API is unreachable (a build without it, or an outage)
 * the page renders from the copy of the same JSON bundled at build time, so
 * it never goes blank.
 */
export async function getContent(lang: Lang = "en"): Promise<Content> {
  "use cache";
  cacheLife("minutes");
  cacheTag("content");

  try {
    const res = await fetch(`${API_URL}/api/content?lang=${lang}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Content;
  } catch (err) {
    console.warn(`[content] ${API_URL} unavailable, using bundled content:`, (err as Error).message);
    return fillStats(lang === "ru" ? bundledRu : bundledEn, lang);
  }
}
