import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import type { Calendar } from "./generated/Calendar";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

/** The GitHub contribution calendar; `null` without a token or the API. */
export async function getCalendar(): Promise<Calendar | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("calendar");

  try {
    const res = await fetch(`${API_URL}/api/github/calendar`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Calendar | null;
  } catch (err) {
    console.warn("[calendar] API unavailable:", (err as Error).message);
    return null;
  }
}
