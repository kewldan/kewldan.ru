import { RevealGroup, RevealItem } from "@/components/motion/reveal";
import { SectionLabel } from "@/components/section-label";
import type { Stack as StackContent } from "@/lib/api/generated/Stack";
import { cn } from "@/lib/utils";

const FILLS = ["bg-yellow", "bg-blue", "bg-pink"];

export function Stack({ stack }: { stack: StackContent }) {
  return (
    <section id="stack" className="wrap grid-index border-t-[1.5px] border-ink py-section">
      <SectionLabel label={stack.label} />
      <div className="col-span-12 flex min-w-0 flex-col gap-7 md:col-span-9 md:col-start-4">
        <RevealGroup each={0.06} className="flex flex-wrap gap-3.5">
          {stack.headline.map((s, i) => (
            <RevealItem
              key={s}
              as="span"
              className={cn(
                "px-4.5 py-2 text-chip-xl font-bold tracking-[-0.03em] shadow-[5px_5px_0_var(--ink)] transition-transform duration-(--dur-fast) ease-snap brutal hover:scale-105 hover:-rotate-4",
                FILLS[i % FILLS.length],
              )}
            >
              {s}
            </RevealItem>
          ))}
        </RevealGroup>
        <p className="text-md text-ink-muted">{stack.note}</p>
        <RevealGroup each={0.07} className="grid grid-cols-1 gap-x-4 gap-y-7 md:grid-cols-3">
          {stack.groups.map((g) => (
            <RevealItem key={g.id}>
              <h3 className="mb-2 border-t-[1.5px] border-ink pt-2.5 text-sm font-medium text-ink-muted">{g.name}</h3>
              <p className="text-[16.5px] leading-normal">{g.items.join(", ")}</p>
              <small className="mt-2 block text-[13px] text-ink-muted">Used in {g.usedIn}</small>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
