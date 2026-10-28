"use client";

import { AnimatePresence, motion, useInView, useScroll, useSpring, useTransform } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { fmt, t } from "@/lib/copy";
import type { Media } from "@/lib/api/generated/Media";
import type { Showcase as ShowcaseData } from "@/lib/api/generated/Showcase";
import { ease, rise, spring, stagger, viewport } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { CountUp } from "./keynote";
import type { stageTheme } from "./stage-theme";

type Theme = ReturnType<typeof stageTheme>;

export function Showcase({ data, theme }: { data: ShowcaseData; theme: Theme }) {
  switch (data.kind) {
    case "device":
      return <Device media={data.media} label={data.label} version={data.version} />;
    case "duo":
      return <Duo back={data.back} front={data.front} />;
    case "flow":
      return <Flow steps={data.steps} theme={theme} />;
    case "tiles":
      return <Tiles tiles={data.tiles} />;
    case "logicDemo":
      return <LogicDemo hintOff={data.hintOff} hintOn={data.hintOn} theme={theme} />;
    case "bigNumbers":
      return <BigNumbers items={data.items} theme={theme} />;
  }
}

function Shot({ media, className, priority }: { media: Media; className?: string; priority?: boolean }) {
  return (
    <Image
      src={media.src}
      alt={media.alt}
      width={media.width}
      height={media.height}
      // Already-compressed (and partly animated) WebP: serve as is.
      unoptimized
      priority={priority}
      className={cn("block h-auto w-full", className)}
    />
  );
}

/** Screenshot in a glowing frame that tilts up into place as you scroll, glow following the pointer. */
function Device({ media, label, version }: { media: Media; label: string; version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });
  const rotateX = useTransform(p, [0, 1], [24, 0]);
  const scale = useTransform(p, [0, 1], [0.86, 1]);
  const opacity = useTransform(p, [0, 0.35], [0.2, 1]);

  const glow = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--gx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };

  return (
    <div ref={ref} className="mt-5 w-full max-w-245 perspective-[1400px]">
      <motion.div
        style={{ rotateX, scale, opacity }}
        onPointerMove={glow}
        className="origin-bottom rounded-device border border-stage-frame bg-[radial-gradient(640px_circle_at_var(--gx,50%)_var(--gy,0%),rgb(255_95_143/0.22),transparent_60%),var(--stage-device)] p-[clamp(10px,1.8vw,22px)] shadow-[0_40px_120px_rgb(138_107_255/0.18)]"
      >
        <div className="flex justify-between gap-3 px-2 pt-0.5 pb-3 font-mono text-xs text-stage-dim">
          <span className="flex items-center gap-2">
            <i aria-hidden className="size-2 animate-live rounded-full bg-live" />
            {label}
          </span>
          <span>{version}</span>
        </div>
        <Shot media={media} className="rounded-lg" />
      </motion.div>
    </div>
  );
}

/** Two screenshots; the front one floats up faster than the page. */
function Duo({ back, front }: { back: Media; front: Media }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const yFront = useTransform(scrollYProgress, [0, 1], [90, -60]);
  const yBack = useTransform(scrollYProgress, [0, 1], [30, -20]);

  return (
    <div ref={ref} className="relative mt-6 w-full max-w-260 md:pb-[12%]">
      <motion.div
        style={{ y: yBack }}
        initial={{ opacity: 0, x: -40 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={viewport}
        transition={{ duration: 1, ease: ease.out }}
        className="w-full md:w-[82%]"
      >
        <Shot
          media={back}
          className="rounded-[18px] border border-stage-frame shadow-[0_30px_80px_rgb(94_240_194/0.12)]"
        />
      </motion.div>
      <motion.div
        style={{ y: yFront }}
        initial={{ opacity: 0, x: 60 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={viewport}
        transition={{ duration: 1.1, ease: ease.out, delay: 0.15 }}
        className="-mt-[18%] ml-auto w-[70%] md:absolute md:right-0 md:bottom-0 md:mt-0 md:w-[46%]"
      >
        <Shot media={front} className="rounded-lg border border-[#3a3a3c] shadow-[0_30px_60px_rgb(0_0_0/0.6)]" />
      </motion.div>
    </div>
  );
}

/** Pipeline steps; a pulse keeps walking through them while visible. */
function Flow({ steps, theme }: { steps: string[]; theme: Theme }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!inView) return;
    const id = setInterval(() => setActive((a) => (a + 1) % (steps.length + 1)), 650);
    return () => clearInterval(id);
  }, [inView, steps.length]);

  return (
    <motion.div
      ref={ref}
      aria-label={fmt(t.work.flow, { steps: steps.join(t.work.flowJoin) })}
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.12)}
      className="mt-5 flex flex-wrap items-center justify-center gap-2.5"
    >
      {steps.map((s, i) => (
        <motion.div key={s} variants={rise} className="flex items-center gap-2.5">
          {i > 0 && (
            <span
              aria-hidden
              className={cn("transition-colors duration-300", i <= active ? "text-[#b05cff]" : theme.dim)}
            >
              →
            </span>
          )}
          <motion.span
            animate={i === active ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }}
            transition={spring.layout}
            className={cn(
              "rounded-lg bg-white px-4.5 py-3 text-[15px] font-semibold shadow-tile transition-shadow duration-300",
              i === active && "shadow-[0_10px_30px_rgb(176_92_255/0.35)]",
            )}
          >
            {s}
          </motion.span>
        </motion.div>
      ))}
    </motion.div>
  );
}

function Tiles({ tiles }: { tiles: { title: string; body: string }[] }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.1)}
      className="mt-5 grid w-full max-w-260 grid-cols-1 gap-4 text-left md:grid-cols-3"
    >
      {tiles.map((t) => (
        <motion.div
          key={t.title}
          variants={rise}
          whileHover={{ y: -6 }}
          transition={spring.layout}
          className="flex flex-col gap-2.5 rounded-tile bg-white p-7 shadow-[0_1px_0_rgb(0_0_0/0.04)] hover:shadow-[0_24px_60px_rgb(0_0_0/0.08)]"
        >
          <b className="gradient-text text-2xl leading-[1.1] font-bold tracking-[-0.035em]">{t.title}</b>
          <p className="text-[15.5px] leading-[1.45] text-stage-body">{t.body}</p>
        </motion.div>
      ))}
    </motion.div>
  );
}

/** Switch → wire → OR → wire → lamp, the signal travelling left to right. */
function LogicDemo({ hintOff, hintOn, theme }: { hintOff: string; hintOn: string; theme: Theme }) {
  const [on, setOn] = useState(false);
  const wire = (delay: number) => (
    <span className="relative h-1.5 flex-1 overflow-hidden rounded-[3px] bg-stage-frame">
      <motion.span
        className="absolute inset-0 origin-left bg-yellow shadow-[0_0_16px_rgb(255_225_77/0.8)]"
        initial={false}
        animate={{ scaleX: on ? 1 : 0 }}
        transition={{ duration: 0.25, ease: "linear", delay: on ? delay : 0 }}
      />
    </span>
  );

  return (
    <>
      <div className="mt-7 flex w-full max-w-160 items-center">
        <button
          onClick={() => setOn((v) => !v)}
          aria-pressed={on}
          aria-label={t.work.inputSwitch}
          className={cn(
            "flex h-14 w-24 shrink-0 rounded-pill p-1.25 transition-colors duration-300",
            on ? "justify-end bg-[#34c759]" : "justify-start bg-[#3a3a3c]",
          )}
        >
          <motion.span
            layout
            transition={spring.press}
            className="size-11.5 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.35)]"
          />
        </button>
        {wire(0)}
        <motion.span
          initial={false}
          animate={{
            borderColor: on ? "#ffe14d" : "#3a3a3c",
            boxShadow: on ? "0 0 24px rgb(255 225 77 / 0.35)" : "0 0 0 rgb(0 0 0 / 0)",
          }}
          transition={{ delay: on ? 0.22 : 0, duration: 0.2 }}
          className="flex h-16 w-21 shrink-0 items-center justify-center rounded-lg border-2 font-mono text-[15px] font-bold"
        >
          OR
        </motion.span>
        {wire(0.35)}
        <motion.span
          role="img"
          aria-label={on ? t.work.lampOn : t.work.lampOff}
          initial={false}
          animate={
            on
              ? { scale: [1, 1.12, 1], boxShadow: "0 0 60px 16px rgb(255 179 107 / 0.6)" }
              : { scale: 1, boxShadow: "inset 0 0 0 2px #3a3a3c" }
          }
          transition={{ delay: on ? 0.55 : 0, duration: 0.45 }}
          className={cn(
            "size-21 shrink-0 rounded-full transition-[background] duration-300",
            on ? "bg-[radial-gradient(circle,#fff7c9,#ffb36b)] delay-500" : "bg-[#1c1c1e]",
          )}
        />
      </div>
      <div className={cn("min-h-5.5 text-[15px]", theme.dim)} aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={String(on)}
            initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.3 }}
          >
            {on ? hintOn : hintOff}
          </motion.p>
        </AnimatePresence>
      </div>
    </>
  );
}

function BigNumbers({ items, theme }: { items: { value: string; label: string }[]; theme: Theme }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="shown"
      viewport={viewport}
      variants={stagger(0.12)}
      className="mt-3 grid w-full max-w-260 grid-cols-1 gap-6 md:grid-cols-3"
    >
      {items.map((s) => (
        <motion.div key={s.label} variants={rise}>
          <CountUp
            value={s.value}
            className="block gradient-text pb-[0.04em] text-huge font-bold tracking-[-0.065em]"
          />
          <span className={cn("text-[15px]", theme.dim)}>{s.label}</span>
        </motion.div>
      ))}
    </motion.div>
  );
}

/** A shell command you can click to copy. */
export function CopyCommand({ command }: { command: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast(t.work.copied);
    } catch {
      toast(t.work.copyFailed);
    }
  };
  return (
    <motion.button
      onClick={copy}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={spring.press}
      className="group max-w-full overflow-x-auto rounded-[14px] bg-stage-tile px-5 py-3.5 font-mono text-[clamp(13px,1.4vw,16px)] whitespace-nowrap text-stage-chip"
      aria-label={fmt(t.work.copyLabel, { command })}
    >
      <b className="font-medium text-mint">$</b> {command}
      <span className="ml-3 text-xs text-stage-dim opacity-0 transition-opacity group-hover:opacity-100">
        {t.work.copy}
      </span>
    </motion.button>
  );
}
