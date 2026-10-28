"use client";

import { motion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef } from "react";

import { RichReveal } from "@/components/motion/rich-reveal";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { accentBg } from "@/lib/accent";
import type { Hero as HeroContent } from "@/lib/api/generated/Hero";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: ease.out, delay },
});

export function Hero({ hero }: { hero: HeroContent }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // The headline drifts up a touch slower than the page: cheap depth.
  const drift = useTransform(scrollYProgress, [0, 1], [0, -80]);

  return (
    <section
      ref={ref}
      id="top"
      className="relative wrap flex flex-col gap-[clamp(28px,4vw,56px)] pt-[clamp(28px,4vw,56px)] pb-[clamp(64px,8vw,112px)]"
    >
      <dl className="grid grid-cols-2 gap-4 border-t-[1.5px] border-ink pt-3 text-[13.5px] leading-[1.4] md:grid-cols-4">
        {hero.meta.map((m, i) => (
          <motion.div key={m.title} {...enter(0.05 * i)}>
            <dt>
              {m.live && <i aria-hidden className="mr-1.75 inline-block size-2.25 animate-live rounded-full bg-live" />}
              {m.title}
            </dt>
            <dd className="text-ink-muted">{m.sub}</dd>
          </motion.div>
        ))}
      </dl>

      <div className="relative">
        <motion.div style={{ y: drift }}>
          <RichReveal
            as="h1"
            immediate
            each={0.06}
            text={hero.headline}
            className="relative z-10 max-w-[10.5ch] text-display font-semibold text-balance [font-variation-settings:'wdth'_80]"
          />
        </motion.div>
        <Photo hero={hero} />
      </div>

      <div className="grid-index">
        <SectionLabel label={hero.label} />
        <motion.p {...enter(0.5)} className="col-span-12 text-lead text-pretty md:col-span-5 md:col-start-4">
          {hero.lead}
        </motion.p>
        <Stickers stickers={hero.stickers} />
        <motion.div {...enter(0.6)} className="col-span-12 flex flex-col gap-0.5 md:col-span-2 md:col-start-11">
          {hero.links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="group flex justify-between gap-2.5 border-b-[1.5px] border-ink py-2.25 text-[15px] transition-colors hover:border-cobalt hover:text-cobalt"
            >
              {l.label}
              <span className="transition-transform duration-(--dur-fast) group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                ↗
              </span>
            </a>
          ))}
        </motion.div>
      </div>

      <motion.div {...enter(0.7)} className="flex flex-wrap gap-3.5">
        {hero.ctas.map((c) => (
          <Button key={c.label} asChild variant="brutal" size="brutal" className={cn(c.accent && accentBg[c.accent])}>
            <a href={c.href}>{c.label}</a>
          </Button>
        ))}
      </motion.div>
    </section>
  );
}

function Photo({ hero }: { hero: HeroContent }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, rotate: 12, scale: 0.8, y: 30 }}
      animate={{ opacity: 1, rotate: 2, scale: 1, y: 0 }}
      transition={{ ...spring.toss, delay: 0.35 }}
      whileHover={{ rotate: -1, scale: 1.03 }}
      className="mt-6 w-47.5 md:absolute md:top-[2%] md:right-[1%] md:mt-0 md:w-[min(24%,290px)]"
    >
      <div className="relative flex aspect-square items-end overflow-hidden bg-blue bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.06)_0_10px,rgb(0_0_0/0.13)_10px_20px)] p-2 shadow-brutal brutal">
        {hero.photo ? (
          <Image
            src={hero.photo.src}
            alt={hero.photo.alt}
            fill
            priority
            unoptimized
            sizes="(min-width: 768px) 290px, 190px"
            className="object-cover"
          />
        ) : (
          <span
            role="img"
            aria-label={t.photoPlaceholder}
            className="border-2 border-ink bg-surface px-1.5 py-0.5 font-mono text-[11px]"
          >
            {hero.photoPlaceholder}
          </span>
        )}
      </div>
    </motion.div>
  );
}

/** Stickers you can peel off and toss around; they spring back home. */
function Stickers({ stickers }: { stickers: HeroContent["stickers"] }) {
  return (
    <div
      aria-hidden
      className="col-span-12 flex flex-row flex-wrap items-start gap-4 pt-1 md:col-span-2 md:col-start-9 md:flex-col"
    >
      {stickers.map((s, i) => (
        <motion.span
          key={s.label}
          drag
          dragSnapToOrigin
          dragElastic={0.6}
          dragTransition={{ bounceStiffness: 300, bounceDamping: 14 }}
          initial={{ opacity: 0, scale: 1.6, rotate: s.tilt * 3 }}
          animate={{ opacity: 1, scale: 1, rotate: s.tilt }}
          transition={{ ...spring.toss, delay: 0.55 + i * 0.12 }}
          whileHover={{ rotate: 0, scale: 1.06 }}
          whileDrag={{ rotate: 0, scale: 1.12, boxShadow: "10px 12px 0 var(--ink)", zIndex: 30 }}
          className={cn(
            "relative z-20 cursor-grab touch-none px-3.5 py-2.25 font-mono text-md font-bold whitespace-nowrap shadow-[5px_5px_0_var(--ink)] select-none brutal active:cursor-grabbing",
            accentBg[s.accent],
          )}
        >
          {s.label}
        </motion.span>
      ))}
    </div>
  );
}
