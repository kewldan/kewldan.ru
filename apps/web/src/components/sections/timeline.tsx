"use client";

import { motion, type Variants } from "motion/react";

import { Reveal } from "@/components/motion/reveal";
import { SectionLabel } from "@/components/section-label";
import type { Timeline as TimelineContent } from "@/lib/api/generated/Timeline";
import { viewport } from "@/lib/motion";

const entry: Variants = {
  hidden: { opacity: 0, x: -8 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

/** `git log` that prints itself, one commit at a time, as the card comes into view. */
export function Timeline({ timeline }: { timeline: TimelineContent }) {
  return (
    <section id="log" className="wrap grid-index border-t-[1.5px] border-ink py-section">
      <SectionLabel label={timeline.label} />
      <Reveal className="col-span-12 min-w-0 md:col-span-9 md:col-start-4">
        <div className="bg-term-bg font-mono text-sm leading-[1.6] text-term-fg shadow-brutal-lg brutal">
          <div className="flex justify-between gap-3 border-b border-term-rule px-4 py-2.5 text-xs text-term-dim">
            <span aria-hidden className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-[#ff5f57]" />
              <i className="size-2.5 rounded-full bg-[#febc2e]" />
              <i className="size-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span>{timeline.host}</span>
            <span>zsh</span>
          </div>
          <motion.div
            initial="hidden"
            whileInView="shown"
            viewport={viewport}
            variants={{ shown: { transition: { staggerChildren: 0.12, delayChildren: 0.3 } } }}
            className="flex flex-col gap-4.5 px-[clamp(16px,3vw,32px)] py-5"
          >
            <motion.p variants={entry} className="text-term-dim">
              <b className="font-medium text-term-hash">~</b> $ {timeline.command}
              <motion.span
                aria-hidden
                className="ml-1 inline-block h-[1.1em] w-[0.55em] translate-y-[3px] bg-term-fg"
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
              />
            </motion.p>
            {timeline.commits.map((c, i) => (
              <motion.div key={c.hash} variants={entry}>
                <div>
                  <span className="text-term-hash">commit {c.hash}</span>
                  {i === 0 && <span className="text-term-head"> (HEAD -&gt; main)</span>}
                </div>
                <div className="text-term-dim">Date: {c.year}</div>
                <div className="pl-[4ch] font-bold text-[#f4f6f3]">{c.message}</div>
                <div className="max-w-[84ch] pl-[4ch] text-term-dim">{c.body}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </Reveal>
    </section>
  );
}
