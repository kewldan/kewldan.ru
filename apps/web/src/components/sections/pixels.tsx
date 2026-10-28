import { Reveal } from "@/components/motion/reveal";
import { RichReveal } from "@/components/motion/rich-reveal";
import { SectionLabel } from "@/components/section-label";
import type { PixelsSection } from "@/lib/api/generated/PixelsSection";

import { PixelBattle } from "./pixel-battle/pixel-battle";

export function Pixels({ section }: { section: PixelsSection }) {
  return (
    <section id="pixels" className="wrap grid-index border-t-[1.5px] border-ink py-section">
      <SectionLabel label={section.label} />
      <div className="col-span-12 flex min-w-0 flex-col gap-7 md:col-span-9 md:col-start-4">
        <RichReveal text={section.title} className="max-w-[22ch] text-pull font-medium text-pretty" />
        <Reveal>
          <PixelBattle />
        </Reveal>
      </div>
    </section>
  );
}
