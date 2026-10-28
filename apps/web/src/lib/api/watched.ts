import "server-only";

import { connection } from "next/server";

import type { Title } from "./generated/Title";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

/** The list at request time: edits show up on the next reload. */
export async function getWatched(): Promise<Title[] | null> {
  await connection();
  try {
    const res = await fetch(`${API_URL}/api/watched`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { items: Title[] }).items;
  } catch (err) {
    console.warn("[watched] API unavailable:", (err as Error).message);
    return null;
  }
}
