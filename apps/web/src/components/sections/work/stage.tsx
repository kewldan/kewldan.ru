"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

/**
 * The black keynote stage. It enters as an inset card with round corners and
 * opens up to full bleed as it reaches the top of the viewport, so leaving
 * the paper reads as a scene change, not a colour change.
 */
export function Stage({
  id,
  seamless,
  children,
}: {
  id?: string;
  /** Directly after another stage: skip the entrance. */
  seamless?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 15%"] });
  const inset = useTransform(scrollYProgress, [0, 1], [5, 0]);
  const radius = useTransform(scrollYProgress, [0, 1], [48, 0]);
  const clipPath = useTransform(
    [inset, radius],
    ([i, r]) => `inset(0 ${i as number}% 0 ${i as number}% round ${r as number}px ${r as number}px 0 0)`,
  );

  return (
    <motion.section
      ref={ref}
      id={id}
      style={seamless ? undefined : { clipPath }}
      className="overflow-x-clip bg-stage font-stage tracking-[-0.015em] text-stage-fg"
    >
      {children}
    </motion.section>
  );
}
