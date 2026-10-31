"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { RevealGroup, RevealItem } from "@/components/motion/reveal";
import { SectionLabel } from "@/components/section-label";
import { accentBg } from "@/lib/accent";
import type { Car as CarContent } from "@/lib/api/generated/Car";
import type { OffScreen as OffScreenContent } from "@/lib/api/generated/OffScreen";
import { useT } from "@/components/lang";
import { ease, spring, viewport } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { Casings } from "./casings";

const box =
  "brutal flex min-w-0 flex-col gap-3 bg-surface p-5.5 shadow-[7px_7px_0_var(--ink)] transition-[translate,box-shadow] duration-(--dur-fast) hover:-translate-y-1 hover:shadow-[7px_11px_0_var(--ink)]";
const kicker = "font-mono text-xs tracking-[0.06em] uppercase";

export function OffScreen({ off }: { off: OffScreenContent }) {
  return (
    <section className="wrap grid-index border-t-[1.5px] border-ink py-section">
      <SectionLabel label={off.label} />
      <RevealGroup
        each={0.08}
        className="col-span-12 grid min-w-0 grid-cols-1 gap-5.5 md:col-span-9 md:col-start-4 md:grid-cols-2 lg:grid-flow-dense lg:grid-cols-3"
      >
        <RevealItem className={cn(box, "bg-white text-on-accent md:col-span-2")}>
          <span className={kicker}>{off.car.kicker}</span>
          <Car car={off.car} />
          <p className="font-bold">
            {off.car.name} <span className="bg-yellow px-1">{off.car.note}</span>
          </p>
        </RevealItem>

        <RevealItem
          className={cn(
            box,
            "@container grid grid-cols-[minmax(0,1fr)_116px] gap-0 bg-pink p-0 text-on-accent md:col-span-2",
          )}
        >
          <div className="flex flex-col gap-2 border-r-3 border-dashed border-ink p-5.5">
            <span className={kicker}>{off.trip.kicker}</span>
            <p className="flex items-center gap-1 text-[clamp(30px,12cqi,58px)] leading-none font-bold tracking-[-0.05em] whitespace-nowrap">
              {off.trip.from}
              <motion.span
                aria-hidden
                className="inline-block text-[0.6em]"
                initial={{ x: -10, opacity: 0 }}
                whileInView={{ x: 0, opacity: 1 }}
                viewport={viewport}
                transition={{ duration: 0.8, ease: ease.out, delay: 0.3 }}
              >
                ✈
              </motion.span>
              {off.trip.to}
            </p>
            <p>
              {off.trip.fromCity} → {off.trip.toCity}
            </p>
            <p className="mt-auto font-bold">{off.trip.motto}</p>
          </div>
          <div className="flex flex-col justify-between gap-2.5 px-3 py-4">
            <div className="relative flex aspect-square items-end overflow-hidden border-3 border-ink bg-yellow bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.06)_0_8px,rgb(0_0_0/0.14)_8px_16px)] p-1 font-mono text-[10px]">
              {off.trip.photo ? (
                <Image
                  src={off.trip.photo.src}
                  alt={off.trip.photo.alt}
                  fill
                  unoptimized
                  sizes="120px"
                  className="object-cover transition-transform duration-(--dur-base) hover:scale-110"
                />
              ) : (
                off.trip.photoPlaceholder
              )}
            </div>
            <div
              aria-hidden
              className="h-11 bg-[repeating-linear-gradient(90deg,#0d0d0f_0_3px,transparent_3px_5px,#0d0d0f_5px_7px,transparent_7px_11px)]"
            />
          </div>
        </RevealItem>

        <RevealItem className={cn(box, "bg-night text-white md:col-span-2 lg:col-span-3")}>
          <span className={kicker}>{off.steam.kicker}</span>
          <div className="flex flex-wrap gap-2">
            {off.steam.games.map((g) => (
              <motion.span
                key={g.name}
                whileHover={{ y: -3, rotate: -2 }}
                transition={spring.press}
                className={cn(
                  "border-[2.5px] px-3 py-1.5 text-[15px] font-semibold",
                  g.hours ? "border-yellow bg-yellow text-on-accent" : "border-white",
                )}
              >
                {g.name}
                {g.hours && ` · ${g.hours}`}
              </motion.span>
            ))}
          </div>
        </RevealItem>

        {off.cards.map((c) => {
          const casings = c.widget === "casings";
          return (
            <RevealItem
              key={c.title}
              className={cn(box, accentBg[c.accent], casings && "relative isolate min-h-72 overflow-hidden")}
            >
              {casings && <Casings />}
              <span className={cn(kicker, "relative")}>{c.kicker}</span>
              <h3 className="relative text-box leading-[0.95] font-bold tracking-[-0.045em]">{c.title}</h3>
              <p className="relative text-[16.5px] leading-[1.45] font-medium">{c.body}</p>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </section>
  );
}

/** Where the tail-light bar sits, in % of the image width, and how soft the wipe's edge is. */
const LIGHTS = { from: 4, to: 50 };
const FEATHER = 12;

/**
 * The dream car. Scroll it into view and the tail-light bar lights up from
 * left to right: the lit shot sits on top of the dark one and a soft-edged
 * mask sweeps across it. Scroll away and the lights go out, ready to run again.
 * A click switches them by hand until the car leaves the screen.
 */
function Car({ car }: { car: CarContent }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const inView = useInView(ref, { amount: 0.6 });
  const reduced = useReducedMotion();
  const [manual, setManual] = useState<boolean | null>(null);
  // Off screen, the scroll is in charge again.
  const [wasInView, setWasInView] = useState(inView);
  if (inView !== wasInView) {
    setWasInView(inView);
    if (!inView) setManual(null);
  }
  const lit = manual ?? inView;
  const off = LIGHTS.from - FEATHER;
  const on = LIGHTS.to + FEATHER;
  const edge = useMotionValue(off);
  const mask = useTransform(edge, (e) => `linear-gradient(90deg, #000 ${e - FEATHER}%, transparent ${e}%)`);

  useEffect(() => {
    if (reduced) {
      edge.set(lit ? on : off);
      return;
    }
    const controls = lit
      ? animate(edge, on, { duration: manual === null ? 1.4 : 0.9, ease: ease.out, delay: manual === null ? 0.2 : 0 })
      : animate(edge, off, { duration: 0.35, ease: "easeIn" });
    return () => controls.stop();
  }, [lit, manual, reduced, edge, on, off]);

  const img = "block h-auto w-full select-none";
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-pressed={lit}
      aria-label={t.offScreen.lights}
      onClick={() => setManual(!lit)}
      whileTap={{ scale: 0.985 }}
      transition={spring.press}
      className="relative block w-full cursor-pointer"
    >
      <Image
        src={car.image.src}
        alt={car.image.alt}
        width={car.image.width}
        height={car.image.height}
        unoptimized
        className={img}
        sizes="(min-width: 1024px) 640px, 100vw"
      />
      <motion.div aria-hidden className="absolute inset-0" style={{ maskImage: mask, WebkitMaskImage: mask }}>
        <Image
          src={car.imageLit.src}
          alt=""
          width={car.imageLit.width}
          height={car.imageLit.height}
          unoptimized
          className={img}
          sizes="(min-width: 1024px) 640px, 100vw"
        />
      </motion.div>
    </motion.button>
  );
}
