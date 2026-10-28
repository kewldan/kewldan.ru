"use client";

import { useEffect, useRef } from "react";

const W = 128;
const H = 40;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/* A 5×7 bitmap font: every glyph is pixels, so nothing blurs. */
const FONT: Record<string, string[]> = {
  " ": ["...", "...", "...", "...", "...", "...", "..."],
  "•": ["...", "...", ".#.", "###", ".#.", "...", "..."],
  ":": [".", "#", "#", ".", "#", "#", "."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  d: ["....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  l: ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  n: [".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  w: [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
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
};

const TITLE = "NOW PLAYING • PORTFOLIO MIX • ";
const TOTAL = 210;
const START = 84;

const glyph = (c: string) => FONT[c] ?? FONT[" "];
const textWidth = (s: string) => [...s].reduce((w, c) => w + glyph(c)[0].length + 1, 0) - 1;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The SteelSeries keyboard OLED: a real 128×40 1-bit framebuffer redrawn at
 * 10 fps like the app does, only while it is on screen.
 */
export function Oled() {
  const ref = useRef<HTMLCanvasElement>(null);

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

    const t0 = performance.now();
    let played = 0;
    let last = 0;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const paused = t % 12 > 10.2;
      if (!paused) played += t - last;
      last = t;
      fb.fill(0);
      if (paused) {
        rect(38, 13, 4, 14);
        rect(45, 13, 4, 14);
        text("PAUSED", 56, 17);
      } else {
        // Spinning record, ordered-dithered to 1 bit.
        const ang = t * 1.8;
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
        const tw = textWidth(TITLE) + 1;
        const sx = 46 - Math.floor((t * 16) % tw);
        text(TITLE, sx, 1, 46, 127);
        text(TITLE, sx + tw, 1, 46, 127);
        text("kewldan", 46, 12);
        const el = (START + played) % TOTAL;
        rect(46, 22, 81, 1);
        rect(46, 27, 81, 1);
        rect(46, 22, 1, 6);
        rect(126, 22, 1, 6);
        rect(48, 24, Math.round((77 * el) / TOTAL), 2);
        text(clock(el), 46, 31);
        const total = clock(TOTAL);
        text(total, 127 - textWidth(total), 31);
      }
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(id);
      if (e.isIntersecting) id = setInterval(frame, 100);
    });
    io.observe(canvas);
    return () => {
      io.disconnect();
      clearInterval(id);
    };
  }, []);

  return (
    <figure className="mt-2.5 flex w-fit max-w-full flex-col gap-1.5">
      <div className="rounded-sm border border-ink bg-[#16171a] px-1.75 py-1.5 shadow-[inset_0_1px_3px_rgb(0_0_0/0.6),2px_2px_0_var(--ink)]">
        <canvas
          ref={ref}
          width={W}
          height={H}
          role="img"
          aria-label="SteelSeries OLED, 128 by 40 pixels: now playing with a spinning 1-bit cover, a scrolling title and a progress bar"
          className="block aspect-[128/40] h-auto w-64 max-w-full bg-black [image-rendering:pixelated]"
        />
      </div>
    </figure>
  );
}
