import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import type { Link } from "@/lib/api/generated/Link";
import { cn } from "@/lib/utils";

/** Keynote links: `primary` ones become the blue pill, the rest text links. */
export function SlideLinks({ links, linkClass, className }: { links: Link[]; linkClass: string; className?: string }) {
  return (
    <Reveal
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-7.5 gap-y-3.5 text-[clamp(16px,1.6vw,19px)]",
        className,
      )}
    >
      {links.map((l) =>
        l.primary ? (
          <Button key={l.href} asChild variant="pill" size="pill">
            <a href={l.href}>{l.label}</a>
          </Button>
        ) : (
          <a key={l.href} href={l.href} className={cn("py-2.5 hover:underline", linkClass)}>
            {l.label}
          </a>
        ),
      )}
    </Reveal>
  );
}
