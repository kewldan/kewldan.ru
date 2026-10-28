import Image from "next/image";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { Rich } from "@/components/rich";
import type { Project } from "@/lib/api/generated/Project";
import type { Work as WorkContent } from "@/lib/api/generated/Work";
import { cn } from "@/lib/utils";

import { KeynoteTitle, Points, Specs } from "./keynote";
import { CopyCommand, Showcase } from "./showcases";
import { SlideLinks } from "./slide-links";
import { Stage } from "./stage";
import { stageTheme } from "./stage-theme";

type Vars = React.CSSProperties & { "--g": string };

export function Work({ work }: { work: WorkContent }) {
  const first = work.projects[0];
  return (
    <Stage id="work">
      <div
        className="wrap flex flex-col items-center gap-5 py-slide text-center"
        style={{ "--g": first?.gradient ?? "none" } as Vars}
      >
        <Reveal>
          <p className="text-eyebrow font-semibold text-stage-dim">{work.eyebrow}</p>
        </Reveal>
        <KeynoteTitle title={work.title} dim={work.titleDim} dimClass="text-stage-dim" />
        <Reveal delay={0.2}>
          <p className="max-w-[42ch] text-sub font-medium text-stage-dim">{work.lead}</p>
        </Reveal>
        <RevealGroup each={0.05} delay={0.2} className="flex flex-wrap justify-center gap-2">
          {work.projects.map((p) => (
            <RevealItem key={p.id}>
              <a
                href={`#p-${p.id}`}
                className="block rounded-pill bg-stage-tile px-3.75 py-2.25 text-sm text-stage-chip transition-colors hover:bg-[#2a2a2d] hover:text-white"
              >
                {p.name}
              </a>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
      {work.projects.map((p) => (
        <Slide key={p.id} project={p} />
      ))}
    </Stage>
  );
}

function Slide({ project: p }: { project: Project }) {
  const t = stageTheme(p.theme);
  const bigNumbers = p.showcase?.kind === "bigNumbers" ? p.showcase : null;
  const lead = (
    <Reveal delay={0.15}>
      <p className={cn("max-w-[42ch] text-sub font-medium", t.dim)}>
        <Rich text={p.lead} classes={{ bold: cn("font-semibold", t.strong) }} />
      </p>
    </Reveal>
  );

  return (
    <div
      id={`p-${p.id}`}
      style={{ "--g": p.gradient } as Vars}
      className={cn("scroll-mt-0", t.slide, !t.light && "border-t border-stage-rule")}
    >
      <div className="wrap flex flex-col items-center gap-5 py-slide text-center">
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
          <p className="gradient-text text-eyebrow font-bold">{p.name}</p>
        </Reveal>
        <KeynoteTitle title={p.title} dim={p.titleDim} dimClass={t.dim} />
        {!bigNumbers && lead}
        {p.showcase && <Showcase data={p.showcase} theme={t} />}
        {bigNumbers && (
          <>
            {lead}
            <Reveal delay={0.1}>
              <CopyCommand command={bigNumbers.command} />
            </Reveal>
          </>
        )}
        {p.specs.length > 0 && <Specs items={p.specs} dimClass={t.dim} />}
        {p.points.length > 0 && <Points points={p.points} dimClass={t.dim} />}
        {p.chips.length > 0 && (
          <RevealGroup each={0.05} className="flex flex-wrap justify-center gap-2">
            {p.chips.map((c) => (
              <RevealItem key={c} as="span" className={cn("rounded-pill px-3.75 py-2.25 text-sm", t.chip)}>
                {c}
              </RevealItem>
            ))}
          </RevealGroup>
        )}
        <SlideLinks links={p.links} linkClass={t.link} />
      </div>
    </div>
  );
}
