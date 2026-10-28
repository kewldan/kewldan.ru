/**
 * Motion tokens, mirrored from src/styles/tokens.css. Components take timing
 * from here instead of inventing numbers, so the whole page moves alike.
 */
import type { Transition, Variants } from "motion/react";

export const ease = {
  /** Long, soft landing. The default for reveals. */
  out: [0.2, 0.7, 0.1, 1],
  /** Overshoots a little: drops, pops, the call sheet. */
  snap: [0.2, 0.9, 0.2, 1.2],
  /** Plain cubic ease-out for counters. */
  cubic: [0.33, 1, 0.68, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const duration = {
  press: 0.08,
  fast: 0.2,
  base: 0.3,
  slow: 0.9,
  count: 1.7,
} as const;

export const spring = {
  /** Brutal buttons and stickers: stiff, barely bounces. */
  press: { type: "spring", stiffness: 700, damping: 30, mass: 0.6 },
  /** Layout moves: filters, underline, list reflow. */
  layout: { type: "spring", stiffness: 420, damping: 38 },
  /** Remote cursors gliding between updates. */
  cursor: { type: "spring", stiffness: 520, damping: 42, mass: 0.5 },
  /** Things you flick around. */
  toss: { type: "spring", stiffness: 260, damping: 18 },
} as const satisfies Record<string, Transition>;

/** Fires once, a bit before the element is fully in view. */
export const viewport = { once: true, margin: "0px 0px -12% 0px" } as const;

/** The page's signature entrance: rise, unblur, settle. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.97, filter: "blur(8px)" },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: duration.slow, ease: ease.out },
  },
};

export const stagger = (each = 0.06, delay = 0): Variants => ({
  hidden: {},
  shown: { transition: { staggerChildren: each, delayChildren: delay } },
});
