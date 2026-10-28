"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Link } from "@/lib/api/generated/Link";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Props = { handle: string; nav: Link[]; marquee: string[] };

export function SiteHeader({ handle, nav, marquee }: Props) {
  return (
    <>
      <Marquee words={marquee} />
      <header className="wrap flex items-center justify-between gap-3 py-4.5">
        <Logo handle={handle} />
        <nav aria-label="Sections" className="hidden gap-x-5.5 text-[15px] md:flex">
          {nav.map((l) => (
            <a key={l.href} href={l.href} className="py-2.5 transition-colors hover:text-cobalt">
              {l.label}
            </a>
          ))}
        </nav>
        <MobileNav nav={nav} />
      </header>
      <FloatingNav handle={handle} nav={nav} />
    </>
  );
}

function Logo({ handle, small }: { handle: string; small?: boolean }) {
  return (
    <a
      href="#top"
      className={cn(
        "bg-yellow font-mono font-bold shadow-brutal-sm transition-[translate,box-shadow] duration-(--dur-fast) brutal hover:-translate-y-0.5 hover:shadow-[5px_6px_0_var(--ink)]",
        small ? "px-2 py-0.5 text-sm" : "px-2.75 py-1.25 text-md",
      )}
    >
      {handle}
    </a>
  );
}

function Marquee({ words }: { words: string[] }) {
  // Four copies: the track slides by half its width and loops seamlessly.
  const row = [...words, ...words, ...words, ...words];
  return (
    <div
      aria-hidden
      className="group overflow-hidden border-b-3 border-ink bg-ink font-mono text-[12.5px] tracking-[0.06em] whitespace-nowrap text-yellow"
    >
      <div className="inline-flex animate-marquee gap-7 py-2.25 group-hover:[animation-play-state:paused]">
        {row.map((w, i) => (
          <span key={i}>{w} ✶</span>
        ))}
      </div>
    </div>
  );
}

/** Which section the reader is in, by the last heading that crossed 40% of the viewport. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  return active;
}

/**
 * A compact bar that slides in once the in-flow header is gone, hides while
 * reading down and returns on the slightest scroll up.
 */
function FloatingNav({ handle, nav }: { handle: string; nav: Link[] }) {
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 260, damping: 40, restDelta: 0.001 });
  const [shown, setShown] = useState(false);
  const ids = useMemo(() => nav.filter((l) => l.href.startsWith("#")).map((l) => l.href.slice(1)), [nav]);
  const active = useActiveSection(ids);

  useMotionValueEvent(scrollY, "change", (y) => {
    const delta = y - (scrollY.getPrevious() ?? y);
    if (y < 400) setShown(false);
    else if (delta < -4) setShown(true);
    else if (delta > 8) setShown(false);
  });

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ y: -90 }}
          animate={{ y: 0 }}
          exit={{ y: -90 }}
          transition={{ duration: 0.35, ease: ease.out }}
          className="fixed inset-x-0 top-0 z-50 border-b-3 border-ink bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur-md"
        >
          <div className="wrap flex h-14 items-center justify-between gap-3">
            <Logo handle={handle} small />
            <nav aria-label="Sections" className="hidden items-center md:flex">
              {nav.map((l) => {
                const on = l.href === `#${active}`;
                return (
                  <a key={l.href} href={l.href} className="relative px-3 py-2 text-sm">
                    {on && (
                      <motion.span
                        layoutId="nav-active"
                        transition={spring.layout}
                        className="absolute inset-0 -z-10 border-2 border-ink bg-yellow"
                      />
                    )}
                    <span className={cn("transition-colors", !on && "hover:text-cobalt")}>{l.label}</span>
                  </a>
                );
              })}
            </nav>
            <MobileNav nav={nav} />
          </div>
          <motion.div aria-hidden style={{ scaleX: progress }} className="h-0.75 origin-left bg-cobalt" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MobileNav({ nav }: { nav: Link[] }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="brutal" size="brutal-sm" className="md:hidden">
          Menu
        </Button>
      </SheetTrigger>
      <SheetContent side="top" className="rounded-none border-b-3 border-ink bg-paper p-0" data-lenis-prevent>
        <SheetTitle className="sr-only">Sections</SheetTitle>
        <nav aria-label="Sections" className="flex flex-col px-4 pt-[calc(env(safe-area-inset-top)+56px)] pb-6">
          {nav.map((l, i) => (
            <SheetClose asChild key={l.href}>
              <motion.a
                href={l.href}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 * i + 0.1, duration: 0.4, ease: ease.out }}
                className="flex items-baseline justify-between border-b-[1.5px] border-ink py-3 text-[32px] font-semibold tracking-[-0.03em]"
              >
                {l.label}
                <span className="font-mono text-xs text-ink-muted">0{i + 1}</span>
              </motion.a>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
