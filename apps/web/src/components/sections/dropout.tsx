"use client";

import { useLenis } from "lenis/react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import type { Dropout as DropoutContent } from "@/lib/api/generated/Dropout";
import { ease } from "@/lib/motion";

/** An 8-beep chirp every 1.8 s, synthesised so there is no audio file to ship. */
function useRingtone() {
  const ring = useRef<{ ctx: AudioContext; id: ReturnType<typeof setInterval> } | null>(null);
  const stop = () => {
    if (!ring.current) return;
    clearInterval(ring.current.id);
    void ring.current.ctx.close().catch(() => {});
    ring.current = null;
  };
  const start = () => {
    stop();
    try {
      const ctx = new AudioContext();
      const burst = () => {
        const t = ctx.currentTime;
        for (let i = 0; i < 8; i++) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "square";
          o.frequency.value = i % 2 ? 660 : 520;
          g.gain.setValueAtTime(0.0001, t + i * 0.09);
          g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.09 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.085);
          o.connect(g).connect(ctx.destination);
          o.start(t + i * 0.09);
          o.stop(t + i * 0.09 + 0.09);
        }
      };
      burst();
      ring.current = { ctx, id: setInterval(burst, 1800) };
    } catch {
      /* no audio: the call is still funny muted */
    }
  };
  useEffect(() => stop, []);
  return { start, stop };
}

export function Dropout({ dropout }: { dropout: DropoutContent }) {
  const [ringing, setRinging] = useState(false);
  const ringtone = useRingtone();
  const lenis = useLenis();

  useEffect(() => {
    if (ringing) lenis?.stop();
    else lenis?.start();
  }, [ringing, lenis]);

  const call = () => {
    setRinging(true);
    ringtone.start();
  };
  // Answering, Esc and a click outside all just hang up.
  const close = () => {
    ringtone.stop();
    setRinging(false);
  };

  return (
    <section className="border-t border-stage-rule bg-stage">
      <div className="wrap flex flex-col items-center gap-2.5 py-14">
        <motion.button
          onClick={call}
          aria-label={dropout.button}
          whileHover={{ x: -2, y: -2, boxShadow: "8px 8px 0 #fff" }}
          whileTap={{ x: 6, y: 6, boxShadow: "0px 0px 0 #fff" }}
          transition={{ duration: 0.08 }}
          className="inline-flex min-h-15 items-center gap-3 bg-pink px-6.5 font-paper text-[clamp(20px,2.4vw,28px)] font-bold text-ink shadow-brutal-white brutal"
        >
          <span aria-hidden className="inline-block animate-beat">
            ❤️
          </span>
          <span>{dropout.button}</span>
        </motion.button>
        <p className="font-mono text-[11px] tracking-[0.08em] text-stage-dim">{dropout.note}</p>
      </div>

      <DialogPrimitive.Root open={ringing} onOpenChange={(open) => !open && close()}>
        <AnimatePresence>
          {ringing && (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-0 z-60 bg-black/45 backdrop-blur-[2px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="fixed inset-x-0 top-0 z-70 flex justify-center outline-none md:inset-0 md:items-center"
                  initial={{ y: "-100%" }}
                  animate={{ y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } }}
                  exit={{ y: "-100%", transition: { duration: 0.3, ease: ease.out } }}
                >
                  <Ringing dropout={dropout} onAnswer={close} />
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      </DialogPrimitive.Root>
    </section>
  );
}

/** The meme: both buttons are green. Either one ends the call. */
function Ringing({ dropout, onAnswer }: { dropout: DropoutContent; onAnswer: () => void }) {
  return (
    <div className="flex h-[50vh] min-h-90 w-full items-center justify-center rounded-b-[28px] bg-[#111214] px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 shadow-[0_30px_80px_rgb(0_0_0/0.6)] md:h-[min(72vh,640px)] md:min-h-0 md:w-auto md:rounded-[28px] md:p-0">
      <DialogPrimitive.Title className="sr-only">Входящий звонок: {dropout.caller}</DialogPrimitive.Title>
      <motion.div
        className="relative aspect-[740/1140] h-full max-w-full"
        animate={{ x: [0, -3, 3, -2, 2, 0, 0], rotate: [0, -0.6, 0.6, 0, 0, 0, 0] }}
        transition={{ duration: 0.9, repeat: Infinity, times: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 1] }}
      >
        <Image
          src={dropout.meme.src}
          alt={dropout.meme.alt}
          width={dropout.meme.width}
          height={dropout.meme.height}
          unoptimized
          priority
          className="block size-full object-contain"
        />
        {[12.6, 54.7].map((left, i) => (
          <button
            key={left}
            autoFocus={i === 0}
            onClick={onAnswer}
            aria-label={i === 0 ? "Ответить" : "Тоже ответить"}
            className="absolute top-[71.5%] h-[21.9%] w-[33.8%] rounded-full focus-visible:outline-white"
            style={{ left: `${left}%` }}
          />
        ))}
      </motion.div>
    </div>
  );
}
