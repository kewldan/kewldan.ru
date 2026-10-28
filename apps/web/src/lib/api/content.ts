import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import bundled from "../../../../api/content/en.json";
import type { Content } from "./generated/Content";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const TIMEOUT_MS = 2500;

/**
 * Site content from the Rust API, cached for a minute and shared by every
 * request. When the API is unreachable (a build without it, or an outage)
 * the page renders from the copy of the same JSON bundled at build time, so
 * it never goes blank.
 */
export async function getContent(): Promise<Content> {
  "use cache";
  cacheLife("minutes");
  cacheTag("content");

  try {
    const res = await fetch(`${API_URL}/api/content`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Content;
  } catch (err) {
    console.warn(`[content] ${API_URL} unavailable, using bundled content:`, (err as Error).message);
    return bundled as Content;
  }
}
