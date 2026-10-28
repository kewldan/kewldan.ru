"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { CELLS, EMPTY, HEIGHT, usePixelBoard, WIDTH } from "./use-pixel-board";

/** Every cell on the straight line between two cells, so fast drags leave no gaps. */
function line(x0: number, y0: number, x1: number, y1: number) {
  const out: number[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push(y0 * WIDTH + x0);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function PixelBattle() {
  const { t, fmt, plural } = useI18n();
  const px = usePixelBoard();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(0);
  const [erase, setErase] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const stroke = useRef<{ x: number; y: number } | null>(null);
  const lastCursor = useRef(0);

  const { board, palette, subscribe } = px;

  // Repaint only what changed.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const draw = (i: number) => {
      const v = board.current[i];
      ctx.fillStyle = v === EMPTY ? "#ffffff" : (palette[v] ?? "#ffffff");
      ctx.fillRect(i % WIDTH, Math.floor(i / WIDTH), 1, 1);
    };
    const all = () => {
      for (let i = 0; i < CELLS; i++) draw(i);
    };
    all();
    return subscribe((cells) => (cells === "all" ? all() : cells.forEach(draw)));
  }, [board, palette, subscribe]);

  const canDraw = px.mode !== "connecting";
  const value = erase ? EMPTY : color;

  const cellAt = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const x = Math.min(WIDTH - 1, Math.max(0, Math.floor(fx * WIDTH)));
    const y = Math.min(HEIGHT - 1, Math.max(0, Math.floor(fy * HEIGHT)));
    return { x, y, fx, fy };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = cellAt(e);
    stroke.current = { x, y };
    px.paint([y * WIDTH + x], value);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y, fx, fy } = cellAt(e);
    setHover((h) => (h?.x === x && h.y === y ? h : { x, y }));
    const now = performance.now();
    if (now - lastCursor.current > 45 && px.mode === "live") {
      lastCursor.current = now;
      px.moveCursor(Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000, value);
    }
    const from = stroke.current;
    if (!from || (from.x === x && from.y === y)) return;
    px.paint(line(from.x, from.y, x, y), value);
    stroke.current = { x, y };
  };

  const onUp = () => {
    if (!stroke.current) return;
    stroke.current = null;
    px.strokeEnd();
  };

  const onLeave = () => {
    onUp();
    setHover(null);
    px.leave();
  };

  const status = {
    connecting: t.pixels.connecting,
    live: fmt(t.pixels.live, { people: plural(px.peers, t.pixels.people) }),
    offline: t.pixels.offline,
  }[px.mode];

  return (
    <div className="flex flex-col bg-surface shadow-brutal-lg brutal">
      <div className="relative touch-none border-b-3 border-ink">
        <canvas
          ref={canvas}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onLeave}
          role="img"
          aria-label={t.pixels.board}
          className={cn(
            "block aspect-[2/1] h-auto w-full touch-none [image-rendering:pixelated]",
            canDraw ? "cursor-crosshair" : "cursor-wait",
          )}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(13_13_15/0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgb(13_13_15/0.07)_1px,transparent_1px)] bg-size-[calc(100%/64)_calc(100%/32)]"
        />
        {hover && canDraw && (
          <span
            aria-hidden
            className="pointer-events-none absolute border-2 border-ink mix-blend-difference"
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / HEIGHT) * 100}%`,
              width: `${100 / WIDTH}%`,
              height: `${100 / HEIGHT}%`,
              borderColor: "#fff",
            }}
          />
        )}
        {px.pings.map((p) => (
          <motion.span
            key={p.key}
            aria-hidden
            initial={{ scale: 1, opacity: 0.9 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="pointer-events-none absolute rounded-full border-2"
            style={{
              left: `${((p.i % WIDTH) / WIDTH) * 100}%`,
              top: `${(Math.floor(p.i / WIDTH) / HEIGHT) * 100}%`,
              width: `${100 / WIDTH}%`,
              height: `${100 / HEIGHT}%`,
              borderColor: px.palette[p.c] ?? "#0d0d0f",
            }}
          />
        ))}
        <AnimatePresence>
          {Object.entries(px.cursors).map(([id, c]) => (
            <motion.span
              key={id}
              aria-hidden
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1, left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ left: spring.cursor, top: spring.cursor, default: { duration: 0.2 } }}
              className="pointer-events-none absolute -mt-0.75 -ml-0.75 aspect-square w-[calc(100%/64+6px)] border-2 border-ink shadow-[0_0_0_2px_#fff]"
              style={{ background: c.c >= 0 ? px.palette[c.c] : "#fff" }}
            />
          ))}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3.5 border-b-3 border-ink p-3 md:px-4 md:py-3.5">
        <div role="group" aria-label={t.pixels.colours} className="flex flex-wrap items-center gap-2.5">
          {px.palette.map((c, i) => {
            const on = !erase && color === i;
            return (
              <motion.button
                key={c}
                aria-label={t.pixels.colourNames[i] ?? c}
                aria-pressed={on}
                disabled={!canDraw}
                onClick={() => {
                  setColor(i);
                  setErase(false);
                }}
                whileTap={{ scale: 0.88 }}
                animate={
                  on
                    ? { x: -2, y: -2, boxShadow: "4px 4px 0 var(--ink)" }
                    : { x: 0, y: 0, boxShadow: "0 0 0 var(--ink)" }
                }
                transition={spring.press}
                className="relative size-9 border-3 border-ink disabled:cursor-not-allowed disabled:opacity-40 md:size-10"
                style={{ background: c }}
              >
                {on && <span className="absolute inset-1 border-3 border-white" />}
              </motion.button>
            );
          })}
          <Button
            variant="brutal"
            size="brutal-sm"
            aria-pressed={erase}
            disabled={!canDraw}
            onClick={() => setErase((v) => !v)}
            className="shadow-none aria-pressed:bg-ink aria-pressed:text-white"
          >
            {t.pixels.eraser}
          </Button>
        </div>
        {px.mode === "offline" && (
          <Button variant="brutal" size="brutal-sm" className="shadow-none" onClick={px.clearLocal}>
            {t.pixels.clear}
          </Button>
        )}
      </div>

      <div
        className="flex items-center gap-3 border-b-3 border-ink px-4 py-2.5 font-mono text-[12.5px]"
        aria-label={fmt(t.pixels.inkLabel, { n: px.ink, max: px.inkMax })}
      >
        <span>{t.pixels.ink}</span>
        <div className="h-3 flex-1 border-2 border-ink bg-surface">
          <motion.div
            className="h-full origin-left bg-yellow"
            animate={{ scaleX: px.ink / px.inkMax }}
            transition={{ type: "spring", stiffness: 300, damping: 40 }}
          />
        </div>
        <span className="w-12 text-right tabular-nums">
          {px.ink}/{px.inkMax}
        </span>
      </div>

      <p
        className="flex flex-wrap justify-between gap-x-5 gap-y-2 px-4 py-2.5 font-mono text-[12.5px]"
        aria-live="polite"
      >
        <span>
          <i
            aria-hidden
            className={cn(
              "mr-2 inline-block size-2.25 rounded-full align-[1px]",
              px.mode === "live" ? "animate-live bg-live" : "bg-[#b0b0b0]",
            )}
          />
          {status}
        </span>
      </p>
    </div>
  );
}
