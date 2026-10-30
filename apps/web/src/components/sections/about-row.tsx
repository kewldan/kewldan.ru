import { RevealItem } from "@/components/motion/reveal";

/** One labelled row of the About list. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <RevealItem className="grid grid-cols-1 gap-4 border-b border-rule py-4.5 text-md leading-normal md:grid-cols-[1fr_2.4fr]">
      <span className="pt-0.75 text-sm text-ink-muted">{label}</span>
      <div>{children}</div>
    </RevealItem>
  );
}
