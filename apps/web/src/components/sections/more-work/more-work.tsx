"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Image from "next/image";
import { useState } from "react";

import { RichReveal } from "@/components/motion/rich-reveal";
import { SectionLabel } from "@/components/section-label";
import { t } from "@/lib/copy";
import type { More } from "@/lib/api/generated/More";
import type { WorkItem } from "@/lib/api/generated/WorkItem";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { Oled } from "./oled";

const ALL = "all";

export function MoreWork({ more }: { more: More }) {
  const [filter, setFilter] = useState(ALL);
  const chips = [{ id: ALL, label: t.more.all }, ...more.categories].map((c) => ({
    ...c,
    count: c.id === ALL ? more.items.length : more.items.filter((w) => w.categories.includes(c.id)).length,
  }));
  const items = more.items.filter((w) => filter === ALL || w.categories.includes(filter));

  return (
    <section id="more" className="wrap flex flex-col gap-7 py-section">
      <div className="grid-index">
        <SectionLabel label={more.label} />
        <div className="col-span-12 flex min-w-0 flex-col gap-3.5 md:col-span-9 md:col-start-4">
          <RichReveal
            text={more.pull}
            each={0.03}
            className="text-pull-sm font-medium tracking-[-0.03em] text-pretty"
          />
          <div role="group" aria-label={t.more.filter} className="flex flex-wrap gap-x-5.5 gap-y-0.5">
            {chips.map((c) => {
              const on = filter === c.id;
              return (
                <button
                  key={c.id}
                  aria-pressed={on}
                  onClick={() => setFilter(c.id)}
                  className={cn(
                    "relative py-2 text-filter font-medium transition-colors",
                    on ? "text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {c.label}
                  <sup className="ml-0.5 font-mono text-[11px]">{c.count}</sup>
                  {on && (
                    <motion.span
                      layoutId="more-filter"
                      transition={spring.layout}
                      className="absolute inset-x-0 bottom-1.5 h-0.5 bg-ink"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <LayoutGroup>
        <motion.ul layout className="border-t-[1.5px] border-ink">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((x, i) => (
              <Row key={x.name} item={x} index={i} />
            ))}
          </AnimatePresence>
        </motion.ul>
      </LayoutGroup>
    </section>
  );
}

function Row({ item: x, index }: { item: WorkItem; index: number }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: ease.out, delay: Math.min(index, 12) * 0.025 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={spring.layout}
      className={cn(
        "group relative isolate grid grid-cols-1 items-baseline gap-1 border-b border-rule px-2 py-4 text-[15px] leading-[1.45] transition-colors duration-(--dur-base) hover:text-white md:grid-cols-[1.3fr_2.6fr_1.2fr_84px] md:gap-4",
        // The cobalt fill wipes up from the bottom edge.
        "before:absolute before:inset-0 before:-z-10 before:origin-bottom before:scale-y-0 before:bg-cobalt before:transition-transform before:duration-(--dur-base) before:ease-out hover:before:scale-y-100",
      )}
    >
      <div>
        <b className="text-lg font-semibold tracking-[-0.015em]">{x.name}</b>
        {x.media && (
          <Image
            src={x.media.src}
            alt={x.media.alt}
            width={x.media.width}
            height={x.media.height}
            unoptimized
            className="mt-2 block aspect-[16/10] w-full max-w-50 border-2 border-ink object-cover transition-transform duration-(--dur-base) group-hover:scale-105 group-hover:-rotate-2"
          />
        )}
        {x.widget === "oled" && <Oled />}
      </div>
      <span>
        {x.what} <span className="text-ink-muted transition-colors group-hover:text-cobalt-soft">{x.detail}</span>
      </span>
      <span className="text-ink-muted transition-colors group-hover:text-cobalt-soft">
        {x.stack}
        {x.status && (
          <span className="ml-2 border-2 border-current px-1.75 py-px font-mono text-[11px] whitespace-nowrap uppercase">
            {x.status}
          </span>
        )}
      </span>
      <span className="font-mono text-[13px] tabular-nums md:text-right">
        {x.href ? (
          <a href={x.href} className="after:absolute after:inset-0">
            {x.year ?? t.more.open} ↗
          </a>
        ) : (
          (x.year ?? "—")
        )}
      </span>
    </motion.li>
  );
}
