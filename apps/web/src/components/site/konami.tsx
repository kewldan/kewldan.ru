"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { t } from "@/lib/copy";

const CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];
/** The pixel board's palette. */
const COLOURS = ["#0d0d0f", "#ffe14d", "#7aa2ff", "#5fe39a", "#ff9a4d", "#2a35ff", "#ff8fd0"];
const COUNT = 90;

type Pixel = { x: number; size: number; colour: string; delay: number; spin: number; fall: number };

const rain = (): Pixel[] =>
  Array.from({ length: COUNT }, () => ({
    x: Math.random() * 100,
    size: 10 + Math.round(Math.random() * 3) * 6,
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    delay: Math.random() * 0.9,
    spin: (Math.random() - 0.5) * 540,
    fall: 1.6 + Math.random() * 1.2,
  }));

/** ↑↑↓↓←→←→BA anywhere on the site: it rains pixels. */
export function Konami() {
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let at = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      at = key === CODE[at] ? at + 1 : key === CODE[0] ? 1 : 0;
      if (at < CODE.length) return;
      at = 0;
      toast(t.konami);
      if (!reduced) setPixels(rain());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reduced]);

  useEffect(() => {
    if (!pixels) return;
    const id = setTimeout(() => setPixels(null), 3800);
    return () => clearTimeout(id);
  }, [pixels]);

  return (
    <AnimatePresence>
      {pixels && (
        <motion.div
          key="rain"
          aria-hidden
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-100 overflow-hidden"
        >
          {pixels.map((p, i) => (
            <motion.span
              key={i}
              initial={{ y: "-10vh", rotate: 0 }}
              animate={{ y: "110vh", rotate: p.spin }}
              transition={{ duration: p.fall, delay: p.delay, ease: "easeIn" }}
              className="absolute top-0 block border-2 border-[#0d0d0f]"
              style={{ left: `${p.x}%`, width: p.size, height: p.size, background: p.colour }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
