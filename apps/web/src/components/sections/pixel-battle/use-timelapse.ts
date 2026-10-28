"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CELLS, EMPTY } from "./use-pixel-board";

type Step = { ms: number; cells: [number, number][] } | { ms: number; board: Int8Array };
export type History = { base: Int8Array; steps: Step[] };

const cell = (b: number) => (b === 46 /* . */ ? EMPTY : b - 48);

function decodeBoard(raw: string) {
  const out = new Int8Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = cell(raw.charCodeAt(i));
  return out;
}

/** `GET /api/pixels/history`: the base board, then `{ms} p i:b,…` / `{ms} b {board}` lines. */
export function parseHistory(text: string): History {
  const [first, ...lines] = text.split("\n");
  const steps: Step[] = [];
  for (const line of lines) {
    const space = line.indexOf(" ");
    const ms = Number(line.slice(0, space));
    const kind = line[space + 1];
    const body = line.slice(space + 3);
    if (kind === "b" && body.length === CELLS) steps.push({ ms, board: decodeBoard(body) });
    else if (kind === "p")
      steps.push({ ms, cells: body.split(",").map((c) => [Number(c.slice(0, -2)), cell(c.charCodeAt(c.length - 1))]) });
  }
  return { base: decodeBoard(first), steps };
}

export type TimelapseState = "off" | "loading" | "ready" | "error";

/**
 * Plays the board's history back: every change in order, idle hours
 * skipped, the whole of it in 4 to 15 seconds. `draw` gets the replayed
 * board after each frame.
 */
export function useTimelapse(draw: (board: Int8Array) => void) {
  const [state, setState] = useState<TimelapseState>("off");
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const history = useRef<History | null>(null);
  const buffer = useRef(new Int8Array(CELLS).fill(EMPTY));
  const applied = useRef(0);
  const cursor = useRef(0);

  /** Shows the board after `n` changes. */
  const seek = useCallback(
    (n: number) => {
      const h = history.current;
      if (!h) return;
      n = Math.max(0, Math.min(h.steps.length, Math.round(n)));
      if (n < applied.current) {
        buffer.current.set(h.base);
        applied.current = 0;
      }
      for (; applied.current < n; applied.current++) {
        const step = h.steps[applied.current];
        if ("board" in step) buffer.current.set(step.board);
        else for (const [i, c] of step.cells) buffer.current[i] = c;
      }
      cursor.current = n;
      setPos(n);
      draw(buffer.current);
    },
    [draw],
  );

  const open = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/pixels/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = parseHistory(await res.text());
      history.current = h;
      buffer.current.set(h.base);
      applied.current = 0;
      setTotal(h.steps.length);
      setState("ready");
      seek(0);
      setPlaying(h.steps.length > 0);
    } catch {
      setState("error");
    }
  }, [seek]);

  const close = useCallback(() => {
    setPlaying(false);
    setState("off");
    history.current = null;
  }, []);

  const toggle = useCallback(() => {
    if (!playing && cursor.current >= total) seek(0);
    setPlaying((p) => !p);
  }, [playing, total, seek]);

  useEffect(() => {
    if (!playing || !total) return;
    const duration = Math.min(15_000, Math.max(4_000, total * 6));
    const perMs = total / duration;
    let last = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      const next = Math.min(total, cursor.current + (now - last) * perMs);
      last = now;
      seek(next);
      cursor.current = next;
      if (next >= total) setPlaying(false);
      else raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, total, seek]);

  /** When the board looked like it does now (Unix ms), for the admin's rewind. */
  const moment = () => {
    const steps = history.current?.steps ?? [];
    if (!steps.length) return null;
    return pos === 0 ? steps[0].ms - 1 : steps[pos - 1].ms;
  };

  return { state, pos, total, playing, open, close, toggle, seek, pause: () => setPlaying(false), moment };
}
