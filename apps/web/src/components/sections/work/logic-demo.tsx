"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { LogicExample } from "@/lib/api/generated/LogicExample";
import { fmt, t } from "@/lib/copy";
import { cn } from "@/lib/utils";

import { at, CATALOG, type Circuit, load, SCHEMES, SWITCH, tick } from "./logic-schemes";
import type { stageTheme } from "./stage-theme";

/** The game's colours: RenderPipeline.cpp (blocks) and background.frag. */
const ON = "#54e645";
const OFF = "#eb4f33";
const CHECKER = ["#33343b", "#2b2e33"];
/** Slow enough to watch a signal walk; the game goes up to 65,536. */
const TPS = 8;
const SPRITE = 32;
const MAX_CELL = 40;
const MAX_HEIGHT = 460;

type Theme = ReturnType<typeof stageTheme>;

/** Per block id: the cut-outs of its sprite, filled with a colour. */
function holes(atlas: HTMLImageElement, color: string) {
  return Array.from({ length: 16 }, (_, i) => {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const g = c.getContext("2d")!;
    g.fillStyle = color;
    g.fillRect(0, 0, SPRITE, SPRITE);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(atlas, 0, i * SPRITE, SPRITE, SPRITE, 0, 0, SPRITE, SPRITE);
    return c;
  });
}

/**
 * Logical System's own examples, running by its rules and drawn with its
 * sprites: grey blocks with cut-outs that are red while off and glow green
 * while on, on the game's checkerboard. Switches flip on click; hovering a
 * block names it, as the game's inspector does.
 */
export function LogicDemo({ examples, theme }: { examples: LogicExample[]; theme: Theme }) {
  const list = examples.filter((e) => SCHEMES[e.id]);
  const [current, setCurrent] = useState(list[0]?.id ?? "");
  const scheme = SCHEMES[current];
  const example = list.find((e) => e.id === current);

  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const circuit = useRef<Circuit>(new Map());
  const ticks = useRef(0);
  const sprites = useRef<{ atlas: HTMLImageElement; on: HTMLCanvasElement[]; off: HTMLCanvasElement[] } | null>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  // The cell under the pointer, and what is there, for the inspector.
  const hover = useRef<[number, number] | null>(null);
  const [hovered, setHovered] = useState<{ t: number; a: boolean } | null>(null);
  const [hud, setHud] = useState(0);
  const inView = useInView(box, { margin: "-10% 0px" });

  // Bounds of the scheme with a cell of margin; y grows upward in the game.
  const xs = scheme?.blocks.map((b) => b[0]) ?? [0];
  const ys = scheme?.blocks.map((b) => b[1]) ?? [0];
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1];
  // Room for labels on both sides.
  const cols = maxX - minX + 1 + 2;
  const rows = maxY - minY + 1;
  const cell = Math.max(14, Math.min(MAX_CELL, Math.floor(width / cols), Math.floor(MAX_HEIGHT / rows)));
  const toScreen = (x: number, y: number) => [(x - minX + 1) * cell, (maxY - y) * cell] as const;

  useEffect(() => {
    const img = new Image();
    img.src = "/media/ls-blocks.png";
    img.onload = () => {
      sprites.current = { atlas: img, on: holes(img, ON), off: holes(img, OFF) };
      setReady(true);
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!scheme) return;
    circuit.current = load(scheme);
    ticks.current = 0;
  }, [scheme]);

  const draw = () => {
    const c = canvas.current;
    const s = sprites.current;
    if (!c || !s || !scheme) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cols * cell;
    const h = rows * cell;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;

    for (let gx = 0; gx < cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        g.fillStyle = CHECKER[(gx + gy + minX + maxY) & 1];
        g.fillRect(gx * cell, gy * cell, cell, cell);
      }
    }

    const sprite = (x: number, y: number, r: number, img: CanvasImageSource, sy: number) => {
      const [sx, sy2] = toScreen(x, y);
      g.save();
      g.translate(sx + cell / 2, sy2 + cell / 2);
      g.rotate((r * Math.PI) / 2);
      g.drawImage(img, 0, sy, SPRITE, SPRITE, -cell / 2, -cell / 2, cell, cell);
      g.restore();
    };

    for (const [x, y, , ,] of scheme.blocks) {
      const b = at(circuit.current, x, y)!;
      sprite(x, y, b.r, (b.a ? s.on : s.off)[b.t], 0);
      sprite(x, y, b.r, s.atlas, b.t * SPRITE);
    }

    // Bloom: the lit cut-outs again, blurred and added on top.
    g.save();
    g.globalCompositeOperation = "lighter";
    g.shadowColor = ON;
    g.shadowBlur = cell * 0.5;
    g.globalAlpha = 0.55;
    for (const [x, y] of scheme.blocks) {
      const b = at(circuit.current, x, y)!;
      if (b.a) sprite(x, y, b.r, s.on[b.t], 0);
    }
    g.restore();

    g.font = `600 ${Math.max(10, Math.round(cell * 0.36))}px var(--font-mono, ui-monospace), monospace`;
    g.textBaseline = "middle";
    for (const [x, y, text, side] of scheme.labels) {
      const [sx, sy] = toScreen(x, y);
      const lit = at(circuit.current, x, y)?.a;
      g.fillStyle = lit ? ON : "rgb(255 255 255 / 0.6)";
      g.textAlign = side === "l" ? "right" : "left";
      g.fillText(text, side === "l" ? sx - cell * 0.18 : sx + cell * 1.18, sy + cell / 2);
    }
  };

  // Redraw on every change of size, scheme or sprites.
  useEffect(draw);

  useEffect(() => {
    if (!inView || !ready) return;
    const id = setInterval(() => {
      tick(circuit.current);
      ticks.current += 1;
      draw();
      inspect();
      setHud(ticks.current);
    }, 1000 / TPS);
    return () => clearInterval(id);
  });

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / cell) + minX - 1, maxY - Math.floor((e.clientY - r.top) / cell)];
  };
  function inspect() {
    const b = hover.current && at(circuit.current, ...hover.current);
    setHovered(b ? { t: b.t, a: b.a } : null);
  }
  const flip = (x: number, y: number) => {
    const b = at(circuit.current, x, y);
    if (b?.t !== SWITCH) return;
    b.a = !b.a;
    draw();
    inspect();
  };
  const switches = scheme?.labels.filter(([x, y]) =>
    scheme.blocks.some((b) => b[0] === x && b[1] === y && b[2] === SWITCH),
  );

  return (
    <div className="mt-6 flex w-full max-w-200 flex-col items-center gap-4">
      {list.length > 1 && (
        <div role="tablist" aria-label={t.work.examples} className="flex flex-wrap justify-center gap-1.5">
          {list.map((e) => (
            <button
              key={e.id}
              role="tab"
              aria-selected={e.id === current}
              onClick={() => setCurrent(e.id)}
              className={cn(
                "rounded-pill px-4 py-2 font-mono text-[13px] transition-colors",
                e.id === current ? "bg-yellow text-[#0d0d0f]" : cn(theme.chip, "hover:text-stage-fg"),
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
      <div ref={box} className="w-full">
        <div
          className="relative mx-auto overflow-hidden rounded-[14px] border border-stage-frame shadow-[0_30px_80px_rgb(84_230_69/0.08)]"
          style={{ width: cols * cell, height: rows * cell }}
        >
          <canvas
            ref={canvas}
            role="img"
            aria-label={fmt(t.work.logicScheme, { name: example?.label ?? "" })}
            className={cn("block size-full", hovered?.t === SWITCH && "cursor-pointer")}
            onPointerMove={(e) => {
              hover.current = cellAt(e);
              inspect();
            }}
            onPointerLeave={() => {
              hover.current = null;
              inspect();
            }}
            onClick={(e) => flip(...cellAt(e))}
          />
          <span className="pointer-events-none absolute top-2 left-2.5 font-mono text-[11px] text-white/45">
            {TPS} TPS · tick {hud} · {scheme?.blocks.length} blocks
          </span>
          {hovered && (
            <span className="pointer-events-none absolute right-2.5 bottom-2 left-2.5 truncate text-left font-mono text-[11px] text-white/70">
              <b className="font-semibold text-white">{CATALOG[hovered.t][0]}</b> · {CATALOG[hovered.t][1]} ·{" "}
              <span style={{ color: hovered.a ? ON : OFF }}>{hovered.a ? "ON" : "OFF"}</span>
            </span>
          )}
        </div>
      </div>
      {/* Switches as buttons too, for keyboards and screen readers. */}
      <div className="sr-only">
        {switches?.map(([x, y, name]) => (
          <button key={name} onClick={() => flip(x, y)}>
            {fmt(t.work.flip, { name })}
          </button>
        ))}
      </div>
      <div className={cn("min-h-11 max-w-[56ch] text-[15px]", theme.dim)} aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={current}
            initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.3 }}
          >
            {example?.hint}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
