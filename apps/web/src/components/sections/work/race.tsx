"use client";

import { motion, useInView } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { Lane } from "@/lib/api/generated/Lane";
import type { Media } from "@/lib/api/generated/Media";
import { fmt } from "@/lib/copy";
import { useT } from "@/components/lang";
import { ease, viewport } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { stageTheme } from "./stage-theme";

type Theme = ReturnType<typeof stageTheme>;

/** Real seconds per raced second: the slowest lane takes about eight. */
const pace = (lanes: Lane[]) => 8 / Math.max(...lanes.map((l) => l.seconds));

/**
 * The app's own screen recording, then the same job raced against the
 * usual tool. Both bars run at the true ratio of their times, and the
 * clocks show the measured seconds, not the shortened ones.
 */
export function Race({ media, task, lanes, theme }: { media: Media; task: string; lanes: Lane[]; theme: Theme }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const k = pace(lanes);
  const longest = Math.max(...lanes.map((l) => l.seconds));
  const fastest = Math.min(...lanes.map((l) => l.seconds));

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let id = 0;
    const frame = (now: number) => {
      const s = (now - start) / 1000 / k;
      setElapsed(Math.min(s, longest));
      if (s < longest) id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [inView, run, k, longest]);

  const done = elapsed >= longest;

  return (
    <div ref={ref} className="mt-6 flex w-full max-w-215 flex-col gap-6">
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={viewport}
        transition={{ duration: 1, ease: ease.out }}
        // The recording is the window itself; only its corners need trimming.
        className="overflow-hidden rounded-[1.6%/2.6%] shadow-[0_40px_120px_rgb(91_124_250/0.25),0_0_0_1px_rgb(255_255_255/0.06)]"
      >
        <Image
          src={media.src}
          alt={media.alt}
          width={media.width}
          height={media.height}
          unoptimized
          className="block h-auto w-full"
        />
      </motion.div>

      <div className="flex flex-col gap-3 text-left">
        <div className={cn("flex items-baseline justify-between gap-4 font-mono text-[12.5px]", theme.dim)}>
          <span className="truncate">{task}</span>
          <button
            onClick={() => {
              setElapsed(0);
              setRun((n) => n + 1);
            }}
            disabled={!done}
            className="shrink-0 transition-opacity disabled:opacity-0"
          >
            {t.work.raceAgain}
          </button>
        </div>
        {lanes.map((l) => {
          const p = Math.min(1, elapsed / l.seconds);
          const first = l.seconds === fastest;
          return (
            <div key={l.name} className="grid grid-cols-[minmax(64px,auto)_1fr_64px] items-center gap-3">
              <span className={cn("font-mono text-[14px]", first ? theme.strong : theme.dim)}>{l.name}</span>
              <span className="relative h-2.5 overflow-hidden rounded-pill bg-stage-tile">
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-pill", first ? "bg-(image:--g)" : "bg-stage-dim/60")}
                  style={{ width: `${p * 100}%` }}
                />
              </span>
              <span
                className={cn(
                  "text-right font-mono text-[14px] tabular-nums",
                  p >= 1 && first ? theme.strong : theme.dim,
                )}
              >
                {(Math.min(elapsed, l.seconds) || 0).toFixed(1)} s{p >= 1 && first ? " ✓" : ""}
              </span>
            </div>
          );
        })}
        <p
          className={cn(
            "h-5 text-right font-mono text-[13px] transition-opacity duration-500",
            theme.dim,
            done ? "opacity-100" : "opacity-0",
          )}
          aria-live="polite"
        >
          {done && fmt(t.work.raceResult, { times: (longest / fastest).toFixed(1) })}
        </p>
      </div>
    </div>
  );
}
