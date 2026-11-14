"use client";

import { motion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { type CSSProperties, useRef } from "react";

import { RichReveal } from "@/components/motion/rich-reveal";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/lang";
import { accentBg } from "@/lib/accent";
import type { Hero as HeroContent } from "@/lib/api/generated/Hero";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The first screen enters in CSS, so it shows up with the first paint
 * instead of after hydration: on a slow phone that is seconds sooner.
 */
const enter = (delay: number) => ({
  className: "animate-enter",
  style: { animationDelay: `${delay}s` },
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
          <div key={m.title} {...enter(0.05 * i)}>
            <dt>
              {m.live && <i aria-hidden className="mr-1.75 inline-block size-2.25 animate-live rounded-full bg-live" />}
              {m.title}
            </dt>
            <dd className="text-ink-muted">{m.sub}</dd>
          </div>
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
        {/* No entrance: it is the largest text on a phone, so it is what the
            page is judged by. Everything around it still moves. */}
        <p className="col-span-12 text-lead text-pretty md:col-span-5 md:col-start-4">{hero.lead}</p>
        <Stickers stickers={hero.stickers} />
        <div {...enter(0.6)} className="col-span-12 flex animate-enter flex-col gap-0.5 md:col-span-2 md:col-start-11">
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
        </div>
      </div>

      <div {...enter(0.7)} className="flex animate-enter flex-wrap gap-3.5">
        {hero.ctas.map((c) => (
          <Button key={c.label} asChild variant="brutal" size="brutal" className={cn(c.accent && accentBg[c.accent])}>
            <a href={c.href}>{c.label}</a>
          </Button>
        ))}
      </div>
    </section>
  );
}

function Photo({ hero }: { hero: HeroContent }) {
  const t = useT();
  return (
    <div
      style={{ animationDelay: "0.35s" }}
      className="mt-6 w-47.5 rotate-2 animate-toss md:absolute md:top-[2%] md:right-[1%] md:mt-0 md:w-[min(24%,290px)]"
    >
      <motion.div whileHover={{ rotate: -3, scale: 1.03 }} transition={spring.toss}>
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
    </div>
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
        <span
          key={s.label}
          className="animate-toss"
          style={
            {
              animationDelay: `${0.55 + i * 0.12}s`,
              "--toss-y": "0px",
              "--toss-r": `${s.tilt * 2}deg`,
              "--toss-s": 1.6,
            } as CSSProperties
          }
        >
          <motion.span
            drag
            dragSnapToOrigin
            dragElastic={0.6}
            dragTransition={{ bounceStiffness: 300, bounceDamping: 14 }}
            style={{ rotate: s.tilt }}
            transition={spring.toss}
            whileHover={{ rotate: 0, scale: 1.06 }}
            whileDrag={{ rotate: 0, scale: 1.12, boxShadow: "10px 12px 0 var(--ink)", zIndex: 30 }}
            className={cn(
              "relative z-20 inline-block cursor-grab touch-none px-3.5 py-2.25 font-mono text-md font-bold whitespace-nowrap shadow-[5px_5px_0_var(--ink)] select-none brutal active:cursor-grabbing",
              accentBg[s.accent],
            )}
          >
            {s.label}
          </motion.span>
        </span>
      ))}
    </div>
  );
}
