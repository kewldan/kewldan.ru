"use client";

import { format } from "date-fns";
import { HistoryIcon, PauseIcon, PlayIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/copy";
import { useI18n } from "@/components/lang";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { adminApi, adminHint, adminToken, type Credential, pixelAdmin } from "@/lib/watched";

import { CELLS, EMPTY, HEIGHT, usePixelBoard, WIDTH } from "./use-pixel-board";
import { useTimelapse } from "./use-timelapse";

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

type Point = { x: number; y: number };
type Area = { x: number; y: number; w: number; h: number };

const areaOf = (a: Point, b: Point): Area => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x) + 1,
  h: Math.abs(a.y - b.y) + 1,
});

const box = (a: { x: number; y: number; w?: number; h?: number }) => ({
  left: `${(a.x / WIDTH) * 100}%`,
  top: `${(a.y / HEIGHT) * 100}%`,
  width: `${((a.w ?? 1) / WIDTH) * 100}%`,
  height: `${((a.h ?? 1) / HEIGHT) * 100}%`,
});

/** The admin's session on this browser, if it has one. */
function useAdmin() {
  const [token, setToken] = useState<Credential | undefined>(undefined);
  useEffect(() => {
    if (!adminHint.get()) return;
    const saved = adminToken.get();
    adminApi.check(saved).then(
      () => setToken(saved),
      () => adminHint.set(false),
    );
  }, []);
  return token;
}

export function PixelBattle() {
  const { t, plural } = useI18n();
  const px = usePixelBoard();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(0);
  const [erase, setErase] = useState(false);
  const [hover, setHover] = useState<Point | null>(null);
  const stroke = useRef<Point | null>(null);
  const lastCursor = useRef(0);
  const replaying = useRef(false);

  const { board, palette, subscribe } = px;
  const admin = useAdmin();
  const [selecting, setSelecting] = useState(false);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Area | null>(null);

  /** Draws `src` onto the canvas: the listed cells, or all of them. */
  const draw = useCallback(
    (src: Int8Array, cells?: number[]) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      const one = (i: number) => {
        const v = src[i];
        ctx.fillStyle = v === EMPTY ? "#ffffff" : (palette[v] ?? "#ffffff");
        ctx.fillRect(i % WIDTH, Math.floor(i / WIDTH), 1, 1);
      };
      if (cells) cells.forEach(one);
      else for (let i = 0; i < CELLS; i++) one(i);
    },
    [palette],
  );

  const tl = useTimelapse(draw);
  const replay = tl.state !== "off";

  // Repaint only what changed; the timelapse owns the canvas while it plays.
  useEffect(() => {
    draw(board.current);
    return subscribe((cells) => {
      if (!replaying.current) draw(board.current, cells === "all" ? undefined : cells);
    });
  }, [board, draw, subscribe]);

  useEffect(() => {
    replaying.current = replay;
    if (!replay) draw(board.current);
  }, [replay, board, draw]);

  const canDraw = px.mode !== "connecting" && !px.locked && !replay;
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
    if (selecting) {
      setAnchor({ x, y });
      setSelection(areaOf({ x, y }, { x, y }));
      return;
    }
    stroke.current = { x, y };
    px.paint([y * WIDTH + x], value);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y, fx, fy } = cellAt(e);
    setHover((h) => (h?.x === x && h.y === y ? h : { x, y }));
    if (selecting) {
      if (anchor) setSelection(areaOf(anchor, { x, y }));
      return;
    }
    const now = performance.now();
    if (now - lastCursor.current > 45 && px.mode === "live" && !replay) {
      lastCursor.current = now;
      px.moveCursor(Math.round(fx * 1000) / 1000, Math.round(fy * 1000) / 1000, value);
    }
    const from = stroke.current;
    if (!from || (from.x === x && from.y === y)) return;
    px.paint(line(from.x, from.y, x, y), value);
    stroke.current = { x, y };
  };

  const onUp = () => {
    setAnchor(null);
    if (!stroke.current) return;
    stroke.current = null;
    px.strokeEnd();
  };

  const onLeave = () => {
    onUp();
    setHover(null);
    px.leave();
  };

  const moderate = async (action: (token: Credential) => Promise<void>) => {
    try {
      await action(admin ?? null);
      toast(t.pixels.admin.done);
      return true;
    } catch {
      toast(t.pixels.admin.failed);
      return false;
    }
  };

  const status = {
    connecting: t.pixels.connecting,
    live: fmt(px.locked ? t.pixels.locked : t.pixels.live, { people: plural(px.peers, t.pixels.people) }),
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
            replay || px.locked ? "cursor-default" : canDraw ? "cursor-crosshair" : "cursor-wait",
          )}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgb(13_13_15/0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgb(13_13_15/0.07)_1px,transparent_1px)] bg-size-[calc(100%/64)_calc(100%/32)]"
        />
        {hover && canDraw && !selecting && (
          <span
            aria-hidden
            className="pointer-events-none absolute border-2 border-ink mix-blend-difference"
            style={{ ...box(hover), borderColor: "#fff" }}
          />
        )}
        {selecting && selection && (
          <span
            aria-hidden
            className="pointer-events-none absolute animate-pulse border-2 border-dashed border-[#ff453a] bg-[#ff453a]/15"
            style={box(selection)}
          />
        )}
        {!replay &&
          px.pings.map((p) => (
            <motion.span
              key={p.key}
              aria-hidden
              initial={{ scale: 1, opacity: 0.9 }}
              animate={{ scale: 3.2, opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="pointer-events-none absolute rounded-full border-2"
              style={{
                ...box({ x: p.i % WIDTH, y: Math.floor(p.i / WIDTH) }),
                borderColor: px.palette[p.c] ?? "#0d0d0f",
              }}
            />
          ))}
        <AnimatePresence>
          {!replay &&
            Object.entries(px.cursors).map(([id, c]) => (
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
        <AnimatePresence>
          {replay && (
            <motion.span
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: ease.out }}
              className="pointer-events-none absolute top-2 left-2 bg-ink px-2 py-1 font-mono text-[12px] text-yellow tabular-nums"
            >
              {tl.state === "ready" && tl.pos > 0 ? format(tl.moment() ?? 0, "d MMM yyyy, HH:mm") : t.pixels.start}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {replay ? (
        <Timelapse tl={tl} admin={admin} moderate={moderate} />
      ) : (
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
      )}

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

      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-2.5 font-mono text-[12.5px]">
        <p aria-live="polite">
          <i
            aria-hidden
            className={cn(
              "mr-2 inline-block size-2.25 rounded-full align-[1px]",
              px.mode === "live" ? "animate-live bg-live" : "bg-[#b0b0b0]",
            )}
          />
          {status}
        </p>
        {px.mode === "live" && !replay && (
          <button
            onClick={tl.open}
            className="inline-flex items-center gap-1.5 py-1 underline-offset-4 hover:underline"
          >
            <HistoryIcon className="size-3.5" />
            {t.pixels.timelapse}
          </button>
        )}
      </div>

      {admin !== undefined && !replay && (
        <Moderation
          selecting={selecting}
          selection={selection}
          onSelect={() => {
            setSelecting((s) => !s);
            setSelection(null);
          }}
          onErase={async () => {
            if (selection && (await moderate((tk) => pixelAdmin.erase(tk, selection)))) {
              setSelection(null);
              setSelecting(false);
            }
          }}
          moderate={moderate}
        />
      )}
    </div>
  );
}

type Tl = ReturnType<typeof useTimelapse>;
type Moderate = (action: (token: Credential) => Promise<void>) => Promise<boolean>;

/** Play/pause, the scrubber, the way back; for the admin, "restore this". */
function Timelapse({ tl, admin, moderate }: { tl: Tl; admin: Credential | undefined; moderate: Moderate }) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const seekAt = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    tl.seek(((e.clientX - r.left) / r.width) * tl.total);
  };
  const progress = tl.total ? tl.pos / tl.total : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b-3 border-ink p-3 md:px-4 md:py-3.5">
      {tl.state === "ready" ? (
        <>
          <Button
            variant="brutal"
            size="brutal-sm"
            onClick={tl.toggle}
            aria-label={tl.playing ? t.pixels.pause : t.pixels.play}
            className="w-11 px-0 shadow-none"
          >
            {tl.playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          </Button>
          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label={t.pixels.scrub}
            aria-valuemin={0}
            aria-valuemax={tl.total}
            aria-valuenow={tl.pos}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              tl.pause();
              seekAt(e);
            }}
            onPointerMove={(e) => e.buttons && seekAt(e)}
            onKeyDown={(e) => {
              const step = Math.max(1, Math.round(tl.total / 100));
              if (e.key === "ArrowRight") tl.seek(tl.pos + step);
              else if (e.key === "ArrowLeft") tl.seek(tl.pos - step);
              else return;
              e.preventDefault();
              tl.pause();
            }}
            className="relative h-11 min-w-40 flex-1 cursor-pointer touch-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 border-2 border-ink bg-surface">
              <div className="h-full origin-left bg-cobalt" style={{ transform: `scaleX(${progress})` }} />
            </div>
            <span
              aria-hidden
              className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 border-3 border-ink bg-yellow"
              style={{ left: `${progress * 100}%` }}
            />
          </div>
        </>
      ) : (
        <span className="flex-1 font-mono text-[13px]">
          {tl.state === "error" ? t.pixels.failed : t.pixels.loading}
        </span>
      )}
      {admin !== undefined && tl.state === "ready" && tl.total > 0 && (
        <Button
          variant="brutal"
          size="brutal-sm"
          className="shadow-none"
          onClick={async () => {
            const at = tl.moment();
            if (at !== null && (await moderate((tk) => pixelAdmin.rewind(tk, at)))) tl.close();
          }}
        >
          {t.pixels.admin.restore}
        </Button>
      )}
      <Button variant="brutal" size="brutal-sm" className="shadow-none" onClick={tl.close}>
        {t.pixels.backToLive}
      </Button>
    </div>
  );
}

/** Admin only: erase an area, wipe the board or bring back the seed. */
function Moderation({
  selecting,
  selection,
  onSelect,
  onErase,
  moderate,
}: {
  selecting: boolean;
  selection: Area | null;
  onSelect: () => void;
  onErase: () => void;
  moderate: Moderate;
}) {
  const { t } = useI18n();
  const [armed, setArmed] = useState<"clear" | "reset" | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const confirm = (what: "clear" | "reset", action: Parameters<Moderate>[0]) => () => {
    if (armed !== what) return setArmed(what);
    setArmed(null);
    void moderate(action);
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5 border-t-3 border-ink bg-ink px-4 py-2.5 font-mono text-[12.5px] text-white">
      <span className="mr-auto text-yellow">{t.pixels.admin.label}</span>
      <button
        aria-pressed={selecting}
        onClick={onSelect}
        className="px-2 py-1 aria-pressed:bg-yellow aria-pressed:text-ink"
      >
        {selecting ? t.pixels.admin.cancel : t.pixels.admin.select}
      </button>
      {selecting && selection && (
        <button onClick={onErase} className="bg-[#ff453a] px-2 py-1 text-white">
          {fmt(t.pixels.admin.erase, { w: selection.w, h: selection.h })}
        </button>
      )}
      <button onClick={confirm("clear", pixelAdmin.clear)} className="px-2 py-1 hover:text-yellow">
        {armed === "clear" ? t.pixels.admin.sure : t.pixels.admin.clear}
      </button>
      <button onClick={confirm("reset", pixelAdmin.reset)} className="px-2 py-1 hover:text-yellow">
        {armed === "reset" ? t.pixels.admin.sure : t.pixels.admin.reset}
      </button>
    </div>
  );
}
