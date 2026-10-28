import type { SectionLabel as Label } from "@/lib/api/generated/SectionLabel";
import { cn } from "@/lib/utils";

/** "(02) Pixel battle": the left column of every paper section. */
export function SectionLabel({ label, className }: { label: Label; className?: string }) {
  return (
    <p className={cn("col-span-12 flex gap-2 pt-1 text-sm text-ink-muted md:col-span-3", className)}>
      <span className="font-mono">({label.index})</span>
      <b className="font-medium text-ink">{label.title}</b>
    </p>
  );
}
