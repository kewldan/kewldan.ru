import Image from "next/image";
import Link from "next/link";

import { LiveStatus } from "@/components/live-status";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { Rich } from "@/components/rich";
import { KeynoteTitle, Specs } from "@/components/sections/work/keynote";
import { SlideLinks } from "@/components/sections/work/slide-links";
import type { CaseSection } from "@/lib/api/generated/CaseSection";
import type { Project } from "@/lib/api/generated/Project";
import { t } from "@/lib/copy";

import { Pipeline } from "./pipeline";

type Vars = React.CSSProperties & { "--g": string };

const onStage = { bold: "font-semibold text-stage-fg", code: "bg-white/10 text-stage-fg" };

/** The long read behind a work slide. */
export function CaseView({ project: p, next }: { project: Project; next: Project | null }) {
  const c = p.case!;
  return (
    <main style={{ "--g": p.gradient } as Vars}>
      <section className="relative overflow-x-clip">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-120 w-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-(image:--g) opacity-[0.16] blur-[120px]"
        />
        <div className="relative wrap flex flex-col items-center gap-5 py-slide text-center">
          {p.icon && (
            <Reveal>
              <Image
                src={p.icon.src}
                alt={p.icon.alt}
                width={72}
                height={72}
                unoptimized
                className="size-18 rounded-[18px]"
              />
            </Reveal>
          )}
          <Reveal>
            <p className="text-eyebrow font-bold">
              <span className="gradient-text">{p.name}</span>
              <span className="text-stage-dim"> · {t.case.eyebrow}</span>
            </p>
          </Reveal>
          {p.probe && <LiveStatus url={p.probe} variant="pill" />}
          <KeynoteTitle as="h1" title={p.title} dim={p.titleDim} dimClass="text-stage-dim" />
          <Reveal delay={0.15}>
            <p className="max-w-[52ch] text-sub font-medium text-stage-dim">
              <Rich text={c.summary} classes={onStage} />
            </p>
          </Reveal>
          {c.facts.length > 0 && <Specs items={c.facts} dimClass="text-stage-dim" />}
        </div>
      </section>

      {c.pipeline.length > 0 && (
        <section className="border-t border-stage-rule">
          <div className="wrap flex flex-col items-center gap-8 py-20 text-center">
            <Reveal>
              <h2 className="text-sm font-semibold tracking-[0.12em] text-stage-dim uppercase">{t.case.flow}</h2>
            </Reveal>
            <Pipeline steps={c.pipeline} />
          </div>
        </section>
      )}

      <div className="wrap max-w-260">
        {c.sections.map((s, i) => (
          <Section key={s.title} section={s} index={i} />
        ))}
      </div>

      <section className="border-t border-stage-rule">
        <div className="wrap flex flex-col items-center gap-6 py-20 text-center">
          {p.chips.length > 0 && (
            <RevealGroup each={0.05} className="flex flex-wrap justify-center gap-2">
              {p.chips.map((chip) => (
                <RevealItem
                  key={chip}
                  as="span"
                  className="rounded-pill bg-stage-tile px-3.75 py-2.25 text-sm text-stage-chip"
                >
                  {chip}
                </RevealItem>
              ))}
            </RevealGroup>
          )}
          <SlideLinks links={p.links} linkClass="text-stage-link" />
        </div>
      </section>

      <nav className="border-t border-stage-rule">
        <div className="wrap flex flex-col gap-10 py-16 md:flex-row md:items-end md:justify-between">
          <Link href="/#work" className="text-stage-chip transition-colors hover:text-stage-fg">
            ← {t.case.allWork}
          </Link>
          {next && (
            <Link
              href={`/work/${next.id}`}
              style={{ "--g": next.gradient } as Vars}
              className="group flex flex-col gap-1 md:items-end md:text-right"
            >
              <span className="text-sm text-stage-dim">{t.case.next}</span>
              <span className="gradient-text text-[clamp(32px,5vw,64px)] leading-none font-bold tracking-[-0.05em]">
                {next.name}
              </span>
              <span className="text-stage-dim transition-colors group-hover:text-stage-fg">
                {next.title} {next.titleDim} ›
              </span>
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}

function Section({ section: s, index }: { section: CaseSection; index: number }) {
  return (
    <section className="grid gap-5 border-t border-stage-rule py-14 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12 md:py-20">
      <Reveal className="md:sticky md:top-24 md:self-start">
        <span className="font-mono text-sm text-stage-dim tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <h2 className="mt-2 text-[clamp(26px,3vw,36px)] leading-[1.1] font-bold tracking-[-0.04em] text-balance">
          {s.title}
        </h2>
      </Reveal>
      <div className="flex flex-col gap-5 text-[clamp(17px,1.5vw,19px)] leading-[1.6] text-stage-note">
        {s.body.map((para, i) => (
          <Reveal key={i} delay={0.05 * i}>
            <p>
              <Rich text={para} classes={onStage} />
            </p>
          </Reveal>
        ))}
        {s.bullets.length > 0 && (
          <RevealGroup as="ul" each={0.07} className="flex flex-col gap-3.5">
            {s.bullets.map((b) => (
              <RevealItem key={b} as="li" className="flex gap-4">
                <span aria-hidden className="mt-[0.8em] h-0.5 w-5 shrink-0 bg-(image:--g)" />
                <span>
                  <Rich text={b} classes={onStage} />
                </span>
              </RevealItem>
            ))}
          </RevealGroup>
        )}
        {s.code && (
          <Reveal>
            <pre className="overflow-x-auto rounded-2xl border border-stage-frame bg-stage-device p-5 font-mono text-[14px] leading-[1.7] text-stage-fg">
              <code>{s.code}</code>
            </pre>
          </Reveal>
        )}
      </div>
    </section>
  );
}
