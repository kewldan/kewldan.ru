"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { Contact as ContactContent } from "@/lib/api/generated/Contact";
import { ease, rise, stagger } from "@/lib/motion";

import { SlideLinks } from "./work/slide-links";
import { Stage } from "./work/stage";

const GRADIENT = "linear-gradient(100deg,#ffb36b 0%,#ff5f8f 34%,#8a6bff 68%,#3fb6ff 100%)";
/** How long "One more thing." holds the stage before the offer appears. */
const PAUSE_MS = 1200;

/**
 * "One more thing." holds the stage for a beat, then the real ask appears on
 * its own; a click skips the wait. Scrolling away before then cancels it.
 */
export function Contact({ contact, email }: { contact: ContactContent; email: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.6 });

  useEffect(() => {
    if (!inView || open) return;
    const id = setTimeout(() => setOpen(true), PAUSE_MS);
    return () => clearTimeout(id);
  }, [inView, open]);

  return (
    <Stage id="contact">
      <div
        ref={ref}
        className="wrap flex min-h-130 flex-col items-center justify-center gap-5 py-slide text-center"
        style={{ "--g": GRADIENT } as React.CSSProperties}
      >
        <AnimatePresence mode="wait" initial={false}>
          {!open ? (
            <motion.button
              key="teaser"
              onClick={() => setOpen(true)}
              aria-expanded={false}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, filter: "blur(10px)", transition: { duration: 0.35, ease: ease.out } }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="rounded-lg px-3.5 py-2 text-more font-bold tracking-[-0.045em] text-stage-fg transition-colors hover:text-stage-dim"
            >
              {contact.teaser}
            </motion.button>
          ) : (
            <motion.div
              key="reveal"
              aria-live="polite"
              initial="hidden"
              animate="shown"
              variants={stagger(0.12)}
              className="flex flex-col items-center gap-5"
            >
              <motion.p variants={rise} className="text-eyebrow font-semibold text-stage-dim">
                {contact.teaser}
              </motion.p>
              <motion.p
                variants={{
                  hidden: { opacity: 0, scale: 0.9, filter: "blur(16px)" },
                  shown: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 1.1, ease: ease.out } },
                }}
                className="gradient-text pb-[0.06em] text-final font-bold tracking-[-0.055em]"
              >
                {contact.title}
              </motion.p>
              <motion.p variants={rise} className="max-w-[42ch] text-sub font-medium text-stage-dim">
                {contact.body}
              </motion.p>
              <motion.div variants={rise}>
                <SlideLinks links={contact.links} linkClass="text-stage-link" />
              </motion.div>
              <motion.div variants={rise} className="flex flex-wrap items-center justify-center gap-x-7.5 text-[15px]">
                {contact.socials.map((s) => (
                  <a key={s.href} href={s.href} className="py-2.5 text-stage-link hover:underline">
                    {s.label} ›
                  </a>
                ))}
                {email && (
                  <a href={`mailto:${email}`} className="py-2.5 text-stage-dim select-all">
                    {email}
                  </a>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Stage>
  );
}
