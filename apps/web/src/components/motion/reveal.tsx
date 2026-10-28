"use client";

import { motion, type HTMLMotionProps } from "motion/react";

import { rise, stagger, viewport } from "@/lib/motion";

type RevealProps = HTMLMotionProps<"div"> & {
  /** Seconds before this element starts. */
  delay?: number;
};

/** Rises into place the first time it scrolls into view. */
export function Reveal({ delay = 0, children, ...props }: RevealProps) {
  return (
    <motion.div
      variants={rise}
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      transition={{ delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

type RevealGroupProps = HTMLMotionProps<"div"> & {
  each?: number;
  delay?: number;
  as?: "div" | "ul" | "ol";
};

/** Staggers its <RevealItem> children in. */
export function RevealGroup({ each = 0.06, delay = 0, as = "div", children, ...props }: RevealGroupProps) {
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag variants={stagger(each, delay)} initial="hidden" whileInView="shown" viewport={viewport} {...props}>
      {children}
    </Tag>
  );
}

export function RevealItem({ as = "div", ...props }: HTMLMotionProps<"div"> & { as?: "div" | "li" | "span" | "p" }) {
  const Tag = motion[as] as typeof motion.div;
  return <Tag variants={rise} {...props} />;
}
