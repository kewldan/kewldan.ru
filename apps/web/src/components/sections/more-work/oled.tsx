"use client";

import { useEffect, useRef } from "react";

import { type Listening, position, useNowPlaying } from "@/lib/now-playing";

const W = 128;
const H = 40;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/* A 5×7 bitmap font: every glyph is pixels, so nothing blurs. Lowercase
 * with descenders sits a row higher to fit the seven rows. */
const FONT: Record<string, string[]> = {
  " ": ["...", "...", "...", "...", "...", "...", "..."],
  "•": ["...", "...", ".#.", "###", ".#.", "...", "..."],
  ":": [".", "#", "#", ".", "#", "#", "."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ",": ["..", "..", "..", "..", "..", ".#", "#."],
  "'": ["#", "#", ".", ".", ".", ".", "."],
  '"': ["#.#", "#.#", "...", "...", "...", "...", "..."],
  "-": ["....", "....", "....", "####", "....", "....", "...."],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "(": ["..#", ".#.", "#..", "#..", "#..", ".#.", "..#"],
  ")": ["#..", ".#.", "..#", "..#", "..#", ".#.", "#.."],
  "[": ["##", "#.", "#.", "#.", "#.", "#.", "##"],
  "]": ["##", ".#", ".#", ".#", ".#", ".#", "##"],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "*": [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".###.", "#....", "#....", "#...#", ".###."],
  d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  f: ["..##.", ".#..#", ".#...", "###..", ".#...", ".#...", ".#..."],
  g: [".....", ".####", "#...#", "#...#", ".####", "....#", ".###."],
  h: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  i: [".#.", "...", "##.", ".#.", ".#.", ".#.", "###"],
  j: ["...#", "....", "..##", "...#", "...#", "#..#", ".##."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  l: ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#...#", "#...#"],
  n: [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", "####.", "#...#", "#...#", "####.", "#....", "#...."],
  q: [".....", ".####", "#...#", "#...#", ".####", "....#", "....#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#...", ".#...", "###..", ".#...", ".#...", ".#..#", "..##."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  v: [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: [".....", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
  z: [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  // Cyrillic, for the Russian half of the library; look-alikes reuse Latin.
  Б: ["#####", "#....", "#....", "####.", "#...#", "#...#", "####."],
  Г: ["#####", "#....", "#....", "#....", "#....", "#....", "#...."],
  Д: [".###.", ".#.#.", ".#.#.", ".#.#.", ".#.#.", "#####", "#...#"],
  Ж: ["#.#.#", "#.#.#", ".###.", "..#..", ".###.", "#.#.#", "#.#.#"],
  З: [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  И: ["#...#", "#...#", "#..##", "#.#.#", "##..#", "#...#", "#...#"],
  Й: ["#.#.#", "#...#", "#..##", "#.#.#", "##..#", "#...#", "#...#"],
  Л: [".####", ".#..#", ".#..#", ".#..#", ".#..#", ".#..#", "##..#"],
  П: ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#"],
  У: ["#...#", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
  Ф: ["..#..", ".###.", "#.#.#", "#.#.#", "#.#.#", ".###.", "..#.."],
  Ц: ["#..#.", "#..#.", "#..#.", "#..#.", "#..#.", "#####", "....#"],
  Ч: ["#...#", "#...#", "#...#", ".####", "....#", "....#", "....#"],
  Ш: ["#.#.#", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "#####"],
  Щ: ["#.#.#.", "#.#.#.", "#.#.#.", "#.#.#.", "#.#.#.", "######", ".....#"],
  Ъ: ["##...", ".#...", ".#...", ".###.", ".#..#", ".#..#", ".###."],
  Ы: ["#...#", "#...#", "#...#", "##..#", "#.#.#", "#.#.#", "##..#"],
  Ь: ["#....", "#....", "#....", "####.", "#...#", "#...#", "####."],
  Э: [".###.", "#...#", "....#", ".####", "....#", "#...#", ".###."],
  Ю: ["#..#.", "#.#.#", "#.#.#", "###.#", "#.#.#", "#.#.#", "#..#."],
  Я: [".####", "#...#", "#...#", ".####", "..#.#", ".#..#", "#...#"],
  б: ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  в: [".....", ".....", "####.", "#...#", "####.", "#...#", "####."],
  г: [".....", ".....", "#####", "#....", "#....", "#....", "#...."],
  д: [".....", ".....", ".###.", ".#.#.", ".#.#.", "#####", "#...#"],
  ж: [".....", ".....", "#.#.#", ".###.", "..#..", ".###.", "#.#.#"],
  з: [".....", ".....", ".###.", "#...#", "..##.", "#...#", ".###."],
  и: [".....", ".....", "#...#", "#..##", "#.#.#", "##..#", "#...#"],
  й: [".....", ".#.#.", "#...#", "#..##", "#.#.#", "##..#", "#...#"],
  к: [".....", ".....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  л: [".....", ".....", ".####", ".#..#", ".#..#", ".#..#", "##..#"],
  м: [".....", ".....", "#...#", "##.##", "#.#.#", "#...#", "#...#"],
  н: [".....", ".....", "#...#", "#...#", "#####", "#...#", "#...#"],
  п: [".....", ".....", "#####", "#...#", "#...#", "#...#", "#...#"],
  т: [".....", ".....", "#####", "..#..", "..#..", "..#..", "..#.."],
  ф: ["..#..", "..#..", ".###.", "#.#.#", "#.#.#", ".###.", "..#.."],
  ц: [".....", ".....", "#..#.", "#..#.", "#..#.", "#####", "....#"],
  ч: [".....", ".....", "#...#", "#...#", ".####", "....#", "....#"],
  ш: [".....", ".....", "#.#.#", "#.#.#", "#.#.#", "#.#.#", "#####"],
  щ: ["......", "......", "#.#.#.", "#.#.#.", "#.#.#.", "######", ".....#"],
  ъ: [".....", ".....", "##...", ".#...", ".###.", ".#..#", ".###."],
  ы: [".....", ".....", "#...#", "#...#", "##..#", "#.#.#", "##..#"],
  ь: [".....", ".....", "#....", "#....", "####.", "#...#", "####."],
  э: [".....", ".....", ".###.", "#...#", "..###", "#...#", ".###."],
  ю: [".....", ".....", "#..#.", "#.#.#", "###.#", "#.#.#", "#..#."],
  я: [".....", ".....", ".####", "#...#", ".####", ".#..#", "#...#"],
};
const ALIASES: Record<string, string> = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "·": "•",
  ...Object.fromEntries([..."АВЕЁКМНОРСТХаеёорсух"].map((c, i) => [c, "ABEEKMHOPCTXaeeopcyx"[i]])),
};

/**
 * Glyphs the font has no drawing for (kana, accents…) are drawn by the
 * browser six times larger, cropped to their ink and shrunk to the 7-row
 * grid by coverage, the way the keyboard app turns fonts into pixels.
 */
const raster = new Map<string, string[]>();
const S = 6;
function rasterize(c: string): string[] {
  const hit = raster.get(c);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 16 * S;
  cv.height = 7 * S;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.font = `${Math.round((7 * S) / 0.72)}px Helvetica, Arial, sans-serif`;
  g.textBaseline = "alphabetic";
  g.fillText(c, S, 7 * S);
  const { data } = g.getImageData(0, 0, cv.width, cv.height);
  const alpha = (x: number, y: number) => data[(y * cv.width + x) * 4 + 3];
  let left = cv.width;
  let right = -1;
  for (let x = 0; x < cv.width; x++)
    for (let y = 0; y < cv.height; y++)
      if (alpha(x, y) > 40) {
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  if (right < 0) return FONT[" "];
  const w = Math.max(1, Math.min(9, Math.round((right - left + 1) / S)));
  const step = (right - left + 1) / w;
  const rows = Array.from({ length: 7 }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      let sum = 0;
      let n = 0;
      for (let j = y * S; j < (y + 1) * S; j++)
        for (let i = Math.floor(left + x * step); i < Math.floor(left + (x + 1) * step); i++) {
          sum += alpha(i, j);
          n += 1;
        }
      return sum / (n * 255) > 0.4 ? "#" : ".";
    }).join(""),
  );
  raster.set(c, rows);
  return rows;
}

const glyph = (c: string) => FONT[ALIASES[c] ?? c] ?? (typeof document === "undefined" ? FONT[" "] : rasterize(c));
const textWidth = (s: string) => [...s].reduce((w, c) => w + glyph(c)[0].length + 1, 0) - 1;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Without Spotify: a made-up mix, paused now and then. */
const DEMO_TITLE = "NOW PLAYING • PORTFOLIO MIX • ";
const DEMO_TOTAL = 210;
const DEMO_START = 84;

function since(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return `${m} MIN AGO`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} H AGO` : `${Math.round(h / 24)} D AGO`;
}

/**
 * The SteelSeries keyboard OLED: a real 128×40 1-bit framebuffer redrawn at
 * 10 fps like the app does, only while it is on screen. It shows what I'm
 * playing on Spotify right now, or a demo mix when Spotify has nothing.
 */
export function Oled() {
  const ref = useRef<HTMLCanvasElement>(null);
  const listening = useNowPlaying();
  const live = useRef<Listening>(null);

  useEffect(() => {
    live.current = listening;
  }, [listening]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const fb = new Uint8Array(W * H);
    const out = ctx.createImageData(W, H);
    const set = (x: number, y: number) => {
      if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = 1;
    };
    const rect = (x: number, y: number, w: number, h: number) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j);
    };
    const text = (s: string, x0: number, y0: number, lo = 0, hi = W - 1) => {
      let x = x0;
      for (const c of s) {
        const g = glyph(c);
        for (let r = 0; r < 7; r++)
          for (let q = 0; q < g[r].length; q++) if (g[r][q] === "#" && x + q >= lo && x + q <= hi) set(x + q, y0 + r);
        x += g[0].length + 1;
      }
    };
    /** A line that scrolls when it does not fit between x 46 and 127. */
    const line = (s: string, y: number, t: number, always = false) => {
      const w = textWidth(s);
      if (w <= 81 && !always) return text(s, 46, y);
      const loop = `${s} • `;
      const lw = textWidth(loop) + 1;
      const sx = 46 - Math.floor((t * 16) % lw);
      text(loop, sx, y, 46, 127);
      text(loop, sx + lw, y, 46, 127);
    };
    const record = (ang: number) => {
      // Spinning record, ordered-dithered to 1 bit.
      for (let y = 0; y < 40; y++)
        for (let x = 0; x < 40; x++) {
          const dx = x - 19.5;
          const dy = y - 19.5;
          const r = Math.hypot(dx, dy);
          let v = 0;
          if (r < 19.5) {
            v = 0.18 + 0.1 * Math.sin(r * 1.9) + 0.6 * Math.max(0, Math.cos(Math.atan2(dy, dx) - ang)) ** 8;
            if (r < 6.5) v = 0.95;
            if (r < 1.8) v = 0;
          }
          if (v * 16 > BAYER[(y & 3) * 4 + (x & 3)]) set(x, y);
        }
    };
    const bar = (part: number) => {
      rect(46, 22, 81, 1);
      rect(46, 27, 81, 1);
      rect(46, 22, 1, 6);
      rect(126, 22, 1, 6);
      rect(48, 24, Math.round(77 * Math.min(1, Math.max(0, part))), 2);
    };

    // Reduced motion: nothing scrolls or spins, but a new track still shows.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let played = 0;
    let last = 0;
    let stopped = 0;
    const frame = () => {
      const t = still ? 0 : (performance.now() - t0) / 1000;
      fb.fill(0);
      const l = live.current;
      if (l) {
        const { track } = l;
        const now = Date.now();
        // The record keeps its angle while nothing plays.
        if (track.playing) stopped = t;
        record(stopped * 1.8);
        const head = track.playing ? "NOW PLAYING" : track.playedAt ? "LAST PLAYED" : "PAUSED";
        line(`${head} • ${track.artists}`, 1, t, true);
        line(track.title, 12, t);
        const total = track.durationMs / 1000;
        bar(track.playing || !track.playedAt ? position(l, now) / track.durationMs : 0);
        text(track.playing || !track.playedAt ? clock(position(l, now) / 1000) : since(track.playedAt, now), 46, 31);
        const end = clock(total);
        if (track.playing || !track.playedAt) text(end, 127 - textWidth(end), 31);
      } else {
        const paused = t % 12 > 10.2;
        if (!paused) played += t - last;
        if (paused) {
          rect(38, 13, 4, 14);
          rect(45, 13, 4, 14);
          text("PAUSED", 56, 17);
        } else {
          record(t * 1.8);
          const tw = textWidth(DEMO_TITLE) + 1;
          const sx = 46 - Math.floor((t * 16) % tw);
          text(DEMO_TITLE, sx, 1, 46, 127);
          text(DEMO_TITLE, sx + tw, 1, 46, 127);
          text("kewldan", 46, 12);
          const el = (DEMO_START + played) % DEMO_TOTAL;
          bar(el / DEMO_TOTAL);
          text(clock(el), 46, 31);
          const total = clock(DEMO_TOTAL);
          text(total, 127 - textWidth(total), 31);
        }
      }
      last = t;
      const d = out.data;
      for (let i = 0; i < fb.length; i++) {
        const on = fb[i] === 1;
        d[i * 4] = on ? 214 : 0;
        d[i * 4 + 1] = on ? 232 : 0;
        d[i * 4 + 2] = on ? 255 : 0;
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    };

    frame();
    let id: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(id);
      if (e.isIntersecting) id = setInterval(frame, still ? 1000 : 100);
    });
    io.observe(canvas);
    return () => {
      io.disconnect();
      clearInterval(id);
    };
  }, []);

  const track = listening?.track;
  return (
    <figure className="mt-2.5 flex w-fit max-w-full flex-col gap-1.5">
      <div className="rounded-sm border border-ink bg-[#16171a] px-1.75 py-1.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.6),2px_2px_0_var(--ink)]">
        <canvas
          ref={ref}
          width={W}
          height={H}
          role="img"
          aria-label={
            track
              ? `SteelSeries OLED, 128 by 40 pixels: ${track.playing ? "now playing" : "last played"} ${track.title} by ${track.artists}`
              : "SteelSeries OLED, 128 by 40 pixels: now playing with a spinning 1-bit cover, a scrolling title and a progress bar"
          }
          className="block aspect-[128/40] h-auto w-64 max-w-full bg-black [image-rendering:pixelated]"
        />
      </div>
    </figure>
  );
}
