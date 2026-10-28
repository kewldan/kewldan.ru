"use client";

import { motion, type Variants } from "motion/react";

import { parseRich, richClass } from "@/components/rich";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const line: Variants = {
  hidden: { y: "105%" },
  shown: { y: "0%", transition: { duration: 0.9, ease: ease.out } },
};

const box: Variants = {
  hidden: { y: "40%", rotate: 8, scale: 0.6, opacity: 0 },
  shown: { y: "0%", rotate: -1.6, scale: 1, opacity: 1, transition: { ...spring.toss, delay: 0.15 } },
};

type Props = {
  text: string;
  className?: string;
  as?: "h1" | "h2" | "p";
  /** Seconds between words. */
  each?: number;
  /** Animate on mount (above the fold) instead of on scroll. */
  immediate?: boolean;
};

/**
 * Rich text whose words slide up out of a mask one after another; a
 * ==mark== box tosses itself into place instead.
 */
export function RichReveal({ text, className, as = "h2", each = 0.07, immediate = false }: Props) {
  const Tag = motion[as];
  const trigger = immediate
    ? { animate: "shown" as const }
    : { whileInView: "shown" as const, viewport: { once: true, margin: "0px 0px -10% 0px" } };
  return (
    <Tag
      className={className}
      initial="hidden"
      {...trigger}
      variants={{ shown: { transition: { staggerChildren: each } } }}
    >
      {parseRich(text).map((t, ti) => {
        if (t.kind === "mark") {
          return (
            <motion.span key={ti} variants={box} className={cn(richClass.mark, "relative z-10")}>
              {t.text}
            </motion.span>
          );
        }
        const cls = t.kind === "text" ? undefined : richClass[t.kind];
        return t.text.split(/(\s+)/).map((word, wi) => {
          if (!word) return null;
          if (/^\s+$/.test(word)) return " ";
          return (
            <span key={`${ti}-${wi}`} className="-mb-[0.08em] inline-block overflow-hidden pb-[0.08em] align-bottom">
              <motion.span variants={line} className={cn("inline-block", cls)}>
                {word}
              </motion.span>
            </span>
          );
        });
      })}
    </Tag>
  );
}
