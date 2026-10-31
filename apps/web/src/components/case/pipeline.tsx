"use client";

import { motion, type Variants } from "motion/react";
import { Fragment } from "react";

import { useT } from "@/components/lang";
import { ease, rise, stagger, viewport } from "@/lib/motion";

const draw: Variants = {
  hidden: { scale: 0, opacity: 0 },
  shown: { scale: 1, opacity: 1, transition: { duration: 0.5, ease: ease.out } },
};

/**
 * A case's architecture as a chain of steps. The steps rise in order, each
 * connector draws itself in between, and then a signal keeps running along
 * the wires: a vertical stack on phones, one row from `lg`.
 */
export function Pipeline({ steps }: { steps: string[] }) {
  const t = useT();
  return (
    <motion.ol
      aria-label={t.work.flow.replace("{steps}", steps.join(t.work.flowJoin))}
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.12)}
      className="flex w-full flex-col items-center lg:flex-row lg:justify-center"
    >
      {steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <motion.li
              aria-hidden
              variants={draw}
              className="relative h-7 w-px overflow-hidden bg-stage-frame lg:h-px lg:w-8 xl:w-12"
            >
              <span
                className="absolute inset-0 hidden w-1/4 animate-flow bg-(image:--g) lg:block"
                style={{ animationDelay: `${i * 0.35}s` }}
              />
            </motion.li>
          )}
          <motion.li
            variants={rise}
            className="flex items-center gap-2.5 rounded-2xl border border-stage-frame bg-stage-tile px-4 py-3 text-[15px] font-medium whitespace-nowrap"
          >
            <span className="font-mono text-xs text-stage-dim tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            {step}
          </motion.li>
        </Fragment>
      ))}
    </motion.ol>
  );
}
