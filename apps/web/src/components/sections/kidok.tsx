import Image from "next/image";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { RichReveal } from "@/components/motion/rich-reveal";
import { SectionLabel } from "@/components/section-label";
import type { Copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

const card =
  "brutal flex min-w-0 flex-col bg-surface shadow-[7px_7px_0_var(--ink)] transition-[translate,rotate,box-shadow] duration-(--dur-fast) hover:-translate-y-1 hover:rotate-0 hover:shadow-[7px_11px_0_var(--ink)]";

/**
 * Someone painted «КИДОК & АБЬЮЗЕР» on the pixel board. The board and
 * the keyed Lambo off Yeat's “Turn Me Up” cover, side by side.
 */
export function Kidok({ t }: { t: Copy["kidok"] }) {
  return (
    <section id="kidok" className="wrap grid-index border-t-[1.5px] border-ink py-section">
      <SectionLabel label={t.label} />
      <div className="col-span-12 flex min-w-0 flex-col gap-7 md:col-span-9 md:col-start-4">
        <RichReveal text={t.title} className="max-w-[22ch] text-pull font-medium text-pretty" />

        <RevealGroup each={0.1} className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <RevealItem className={cn(card, "md:-rotate-2")}>
            <Image
              src="/media/board-kidok.webp"
              alt={t.boardAlt}
              width={1280}
              height={559}
              sizes="(min-width: 768px) 40vw, 100vw"
              className="block aspect-[1280/559] w-full bg-white object-cover"
              style={{ imageRendering: "pixelated" }}
            />
          </RevealItem>
          <RevealItem className={cn(card, "md:rotate-2")}>
            <Image
              src="/media/lambo-kidok.webp"
              alt={t.carAlt}
              width={1024}
              height={1024}
              sizes="(min-width: 768px) 40vw, 100vw"
              className="block aspect-[1280/559] w-full object-cover object-[50%_62%]"
            />
          </RevealItem>
        </RevealGroup>

        <Reveal>
          <p className="inline-block -rotate-1 bg-yellow px-3 py-1.5 font-bold text-on-accent brutal">{t.verdict}</p>
        </Reveal>

        <Reveal>
          <figure className="mt-4 flex flex-col gap-3 border-l-[6px] border-ink pl-5 md:pl-8">
            <blockquote className="flex flex-col gap-2">
              <p className="font-serif text-[clamp(36px,6vw,76px)] leading-[0.95] tracking-[-0.02em] text-balance italic">
                {t.quote}
              </p>
              <p className="max-w-[44ch] text-lg text-ink-muted">{t.quoteTail}</p>
            </blockquote>
            <figcaption className="font-mono text-xs tracking-[0.06em] text-ink-muted uppercase">
              — {t.author}
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
