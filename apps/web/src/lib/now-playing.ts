"use client";

import { useSyncExternalStore } from "react";

import type { NowPlaying } from "@/lib/api/generated/NowPlaying";

/** How often to ask again while the page is open and visible. */
const POLL_MS = 20_000;

/** The track and when it arrived, to move the progress on from there. */
export type Listening = { track: NowPlaying; got: number } | null;

let current: Listening = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function load() {
  fetch("/api/spotify", { cache: "no-store" })
    .then((r) => (r.status === 200 ? (r.json() as Promise<NowPlaying>) : null))
    .catch(() => null)
    .then((track) => {
      current = track && { track, got: Date.now() };
      listeners.forEach((l) => l());
    });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) {
    load();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size) clearInterval(timer);
  };
}

/**
 * What I'm listening to on Spotify (`/api/spotify`), shared by everything
 * on the page that shows it: one request every 20 seconds, however many
 * places use it. `null` until it arrives, and when there is nothing.
 */
export function useNowPlaying(): Listening {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Where the track is now, in ms, counting on from when it arrived. */
export function position(l: NonNullable<Listening>, now: number) {
  const { track, got } = l;
  if (!track.playing) return track.progressMs ?? 0;
  return Math.min(track.durationMs, (track.progressMs ?? 0) + Math.max(0, now - got));
}
