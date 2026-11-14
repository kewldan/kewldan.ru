import type { SectionLabel as Label } from "@/lib/api/generated/SectionLabel";
import { cn } from "@/lib/utils";

/**
 * "Pixel battle": the left column of every paper section, and the
 * section's heading, so the outline reads h1 → section → its cards.
 */
export function SectionLabel({ label, className }: { label: Label; className?: string }) {
  return (
    <h2 className={cn("col-span-12 flex gap-2 pt-1 text-sm text-ink-muted md:col-span-3", className)}>
      <b className="font-medium text-ink">{label.title}</b>
    </h2>
  );
}
