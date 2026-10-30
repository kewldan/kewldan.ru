"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { type Copy, fmt } from "@/lib/copy";
import type { NowPlaying as Track } from "@/lib/api/generated/NowPlaying";
import { cn } from "@/lib/utils";

import { Row } from "./about-row";

/** How often to ask again while the page is open. */
const POLL_MS = 20_000;

function ago(iso: string, now: number) {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  }
  return rtf.format(s, "second");
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * What I'm listening to on Spotify (`/api/spotify`): the track playing now,
 * with its progress running between polls, or the last one played. No
 * row at all when Spotify has nothing to say.
 */
export function NowPlaying({ t }: { t: Copy["about"] }) {
  const [track, setTrack] = useState<Track | null>(null);
  // When the answer arrived, to move the progress bar on from it.
  const [got, setGot] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/spotify", { cache: "no-store" })
        .then((r) => (r.status === 200 ? (r.json() as Promise<Track>) : null))
        .catch(() => null)
        .then((next) => {
          if (stop) return;
          setTrack(next);
          setGot(Date.now());
        });
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const playing = track?.playing ?? false;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), playing ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [playing]);

  if (!track) return null;
  const at = Math.max(now, got);
  const progress = playing ? Math.min(track.durationMs, (track.progressMs ?? 0) + (at - got)) : 0;

  return (
    <Row label={t.listening}>
      <a
        href={track.url}
        target="_blank"
        rel="noreferrer"
        aria-label={fmt(t.onSpotify, { title: track.title, artists: track.artists })}
        className="group flex max-w-120 items-center gap-4 bg-surface p-2.5 pr-4 shadow-brutal-sm transition-[translate,box-shadow] duration-(--dur-fast) brutal hover:-translate-y-0.5 hover:shadow-brutal"
      >
        {track.image && (
          <Image
            src={track.image}
            alt=""
            width={72}
            height={72}
            unoptimized
            className={cn("size-18 shrink-0 object-cover brutal", !playing && "grayscale-[0.6]")}
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 font-mono text-xs font-bold tracking-wide text-ink-muted uppercase">
            {playing ? (
              <span aria-hidden className="flex h-3 items-end gap-0.5">
                {[0, 0.25, 0.5].map((d) => (
                  <i
                    key={d}
                    className="h-full w-0.75 origin-bottom animate-eq bg-green"
                    style={{ animationDelay: `${-d}s` }}
                  />
                ))}
              </span>
            ) : (
              <span aria-hidden className="size-2 rounded-full bg-ink-muted" />
            )}
            {playing ? t.playingNow : fmt(t.lastPlayed, { ago: track.playedAt ? ago(track.playedAt, at) : "" })}
          </span>
          <span className="truncate font-bold group-hover:underline">{track.title}</span>
          <span className="truncate text-sm text-ink-muted">{track.artists}</span>
          {playing && (
            <span className="mt-1 flex items-center gap-2 font-mono text-[11px] text-ink-muted tabular-nums">
              {clock(progress)}
              <span className="relative h-1 flex-1 bg-rule">
                <span
                  className="absolute inset-y-0 left-0 bg-ink"
                  style={{ width: `${(progress / Math.max(1, track.durationMs)) * 100}%` }}
                />
              </span>
              {clock(track.durationMs)}
            </span>
          )}
        </span>
      </a>
    </Row>
  );
}
