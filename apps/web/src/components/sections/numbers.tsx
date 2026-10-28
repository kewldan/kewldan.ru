import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { Rich } from "@/components/rich";
import type { Numbers as NumbersContent } from "@/lib/api/generated/Numbers";

import { CountUp, KeynoteTitle } from "./work/keynote";
import { Stage } from "./work/stage";

const GRADIENT = "linear-gradient(90deg,#5ef0c2 0%,#3fb6ff 60%,#8a6bff 100%)";

export function Numbers({ numbers }: { numbers: NumbersContent }) {
  return (
    <Stage seamless>
      <div
        className="wrap flex flex-col items-center gap-5 py-slide text-center"
        style={{ "--g": GRADIENT } as React.CSSProperties}
      >
        <Reveal>
          <p className="text-eyebrow font-semibold text-stage-dim">{numbers.eyebrow}</p>
        </Reveal>
        <CountUp
          value={numbers.value}
          className="block gradient-text pb-[0.05em] text-mega font-bold tracking-[-0.065em]"
        />
        <KeynoteTitle
          as="p"
          title={numbers.title}
          dim={numbers.titleDim}
          dimClass="text-stage-dim"
          className="text-[clamp(28px,4vw,54px)]"
        />
        <RevealGroup
          each={0.08}
          className="mt-6 grid w-full max-w-230 grid-cols-1 gap-6 border-t border-[#2a2a2d] pt-7 md:grid-cols-3"
        >
          {numbers.trio.map((s) => (
            <RevealItem key={s.label}>
              <CountUp value={s.value} className="block text-trio font-bold tracking-[-0.05em]" />
              <span className="text-sm text-stage-dim">{s.label}</span>
            </RevealItem>
          ))}
        </RevealGroup>
        <Reveal>
          <p className="max-w-[56ch] text-sub font-medium text-stage-dim">
            <Rich text={numbers.note} classes={{ bold: "text-stage-fg" }} />
          </p>
        </Reveal>
        <RevealGroup each={0.04} className="flex flex-wrap justify-center gap-2">
          {numbers.packages.map((p) => {
            const label = `${p.name} · ${p.registry}`;
            const cls =
              "block rounded-pill bg-stage-tile px-3.75 py-2.25 text-sm text-stage-chip transition-colors hover:bg-[#2a2a2d] hover:text-white";
            return (
              <RevealItem key={p.name} as="span">
                {p.href ? (
                  <a href={p.href} className={cls}>
                    {label}
                  </a>
                ) : (
                  <span className={cls}>{label}</span>
                )}
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </Stage>
  );
}
