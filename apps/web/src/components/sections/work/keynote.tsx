"use client";

import { animate, motion, useInView, useMotionValue, useTransform, type Variants } from "motion/react";
import { useEffect, useRef } from "react";

import type { Spec } from "@/lib/api/generated/Spec";
import { duration, ease, rise, stagger, viewport } from "@/lib/motion";
import { cn } from "@/lib/utils";

const lineUp: Variants = {
  hidden: { y: "110%", rotate: 2 },
  shown: { y: "0%", rotate: 0, transition: { duration: 1, ease: ease.out } },
};

/** Two-line keynote headline; each line rises out of its own mask. */
export function KeynoteTitle({
  title,
  dim,
  dimClass,
  as: Tag = "h2",
  className,
}: {
  title: string;
  dim: string;
  dimClass: string;
  as?: "h2" | "p";
  className?: string;
}) {
  const M = motion[Tag];
  return (
    <M
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.12)}
      className={cn("text-keynote font-bold text-balance", className)}
    >
      {[title, dim].map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.06em]">
          <motion.span variants={lineUp} className={cn("block origin-bottom-left", i === 1 && dimClass)}>
            {line}
          </motion.span>
        </span>
      ))}
    </M>
  );
}

/** "65,536" counts up from zero; values that are not numbers just rise in. */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, viewport);
  // "2,195" (the API formats it) plus an optional suffix.
  const match = value.match(/^(\d{1,3}(?:,\d{3})+|\d+)(.*)$/);
  const target = match ? Number(match[1].replace(/\D/g, "")) : NaN;
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US") + (match?.[2] ?? ""));

  useEffect(() => {
    if (!inView || Number.isNaN(target)) return;
    const controls = animate(mv, target, { duration: duration.count, ease: ease.cubic });
    return () => controls.stop();
  }, [inView, target, mv]);

  if (Number.isNaN(target) || value.includes(".")) {
    return (
      <span ref={ref} className={className}>
        {value}
      </span>
    );
  }
  return (
    <motion.span ref={ref} className={cn("tabular-nums", className)} aria-label={value}>
      {text}
    </motion.span>
  );
}

export function Specs({ items, dimClass }: { items: Spec[]; dimClass: string }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.08)}
      className="mt-7 grid w-full max-w-240 grid-cols-2 gap-6 md:grid-cols-4"
    >
      {items.map((s) => (
        <motion.div key={s.label} variants={rise} className="flex flex-col items-center gap-1.5">
          <CountUp value={s.value} className="gradient-text text-spec font-bold tracking-[-0.045em]" />
          <span className={cn("max-w-[19ch] text-sm leading-[1.35]", dimClass)}>{s.label}</span>
        </motion.div>
      ))}
    </motion.div>
  );
}

export function Points({ points, dimClass }: { points: string[]; dimClass: string }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.1)}
      className="mt-4 grid w-full max-w-260 grid-cols-1 gap-7 text-left md:grid-cols-3"
    >
      {points.map((p) => (
        <motion.p key={p} variants={rise} className={cn("text-[16.5px] leading-[1.45] font-medium", dimClass)}>
          <motion.span
            aria-hidden
            variants={{ hidden: { scaleX: 0 }, shown: { scaleX: 1, transition: { duration: 0.8, ease: ease.out } } }}
            className="mb-3 block h-0.5 w-7 origin-left bg-(image:--g)"
          />
          {p}
        </motion.p>
      ))}
    </motion.div>
  );
}
