"use client";

import { useLenis } from "lenis/react";
import { ArrowUpRightIcon, FileTextIcon, HashIcon, LinkIcon, RotateCwIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Link } from "@/lib/api/generated/Link";
import { t } from "@/lib/copy";

export type PaletteData = {
  sections: Link[];
  cases: { id: string; name: string; title: string }[];
  socials: Link[];
};

const item = "gap-3 rounded-xl! px-3 py-2.5 text-[15px] data-selected:bg-white/10 data-selected:text-stage-fg";
const group =
  "p-1.5 text-stage-fg **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:text-[12px] **:[[cmdk-group-heading]]:text-stage-dim";

/** ⌘K / Ctrl+K: every section, case study and profile, one keystroke away. */
export function CommandPalette({ sections, cases, socials }: PaletteData) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const lenis = useLenis();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = (action: () => void) => {
    setOpen(false);
    // Let the dialog hand focus back before the page moves.
    requestAnimationFrame(action);
  };

  const go = (href: string) => {
    if (/^https?:/.test(href)) return void window.open(href, "_blank", "noopener");
    if (!href.startsWith("#")) return router.push(href);
    if (pathname !== "/") return router.push(`/${href}`);
    if (lenis) lenis.scrollTo(href, { offset: -72 });
    else document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", href);
  };

  const barrelRoll = () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.body.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
      duration: 1100,
      easing: "cubic-bezier(0.2, 0.7, 0.1, 1)",
    });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t.palette.title}
      description={t.palette.description}
      className="top-[18%] rounded-[22px]! border border-stage-frame bg-stage-tile font-stage text-stage-fg sm:max-w-xl"
    >
      <Command className="bg-transparent text-stage-fg">
        <CommandInput placeholder={t.palette.placeholder} className="h-11 text-[16px] placeholder:text-stage-dim" />
        <CommandList data-lenis-prevent className="max-h-[min(420px,60dvh)]">
          <CommandEmpty className="text-stage-dim">{t.palette.empty}</CommandEmpty>
          <CommandGroup heading={t.palette.groups.go} className={group}>
            {sections.map((s) => (
              <CommandItem key={s.href} value={s.label} onSelect={() => run(() => go(s.href))} className={item}>
                <HashIcon className="text-stage-dim" />
                {s.label.replace(/\s*↗$/, "")}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t.palette.groups.cases} className={group}>
            {cases.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.name} ${c.title}`}
                onSelect={() => run(() => go(`/work/${c.id}`))}
                className={item}
              >
                <FileTextIcon className="text-stage-dim" />
                {c.name}
                <span className="truncate text-stage-dim">{c.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t.palette.groups.links} className={group}>
            {socials.map((s) => (
              <CommandItem key={s.href} value={s.label} onSelect={() => run(() => go(s.href))} className={item}>
                <ArrowUpRightIcon className="text-stage-dim" />
                {s.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading={t.palette.groups.fun} className={group}>
            <CommandItem
              onSelect={() =>
                run(() => navigator.clipboard.writeText(location.href).then(() => toast(t.palette.copied)))
              }
              className={item}
            >
              <LinkIcon className="text-stage-dim" />
              {t.palette.copyLink}
            </CommandItem>
            <CommandItem onSelect={() => run(barrelRoll)} className={item}>
              <RotateCwIcon className="text-stage-dim" />
              {t.palette.barrelRoll}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
