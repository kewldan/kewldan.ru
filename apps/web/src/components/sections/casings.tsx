"use client";

import type MatterNs from "matter-js";
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

type Matter = typeof MatterNs;
type Kind = "9mm" | "762";
type Casing = { body: MatterNs.Body; kind: Kind; dyingAt?: number };

/** Length × diameter in px: 9×19 Parabellum and the bottlenecked 7.62×39. */
const SIZE: Record<Kind, [number, number]> = { "9mm": [21, 10], "762": [38, 10] };
/** Light from above: shadow, highlight, body, underside. */
const BRASS: Record<Kind, string[]> = {
  "9mm": ["#7a5a17", "#ffe39a", "#d4a542", "#6b4c12"],
  "762": ["#6a4a14", "#f6d283", "#bf8f34", "#5a3e0d"],
};
const MAX = 36;
const FADE_MS = 500;
const STEP = 1000 / 60;
/** Each shot lights the card for a blink; the case leaves a beat later. */
const FLASH_MS = 70;
const EJECT_DELAY = 25;

function drawCasing(ctx: CanvasRenderingContext2D, kind: Kind) {
  const [len, dia] = SIZE[kind];
  const r = dia / 2;
  const x0 = -len / 2;
  const x1 = len / 2;
  const g = ctx.createLinearGradient(0, -r, 0, r);
  const [shadow, light, body, under] = BRASS[kind];
  g.addColorStop(0, shadow);
  g.addColorStop(0.3, light);
  g.addColorStop(0.6, body);
  g.addColorStop(1, under);
  ctx.fillStyle = g;

  ctx.beginPath();
  ctx.moveTo(x0 + 1.5, -r);
  if (kind === "9mm") {
    // Straight walled, a hair narrower at the mouth.
    ctx.lineTo(x1, -r + 0.5);
    ctx.lineTo(x1, r - 0.5);
  } else {
    // Tapered body, shoulder, neck.
    const neck = 3.4;
    const shoulder = x1 - 12;
    const neckStart = x1 - 8;
    ctx.lineTo(shoulder, -r + 1);
    ctx.lineTo(neckStart, -neck);
    ctx.lineTo(x1, -neck);
    ctx.lineTo(x1, neck);
    ctx.lineTo(neckStart, neck);
    ctx.lineTo(shoulder, r - 1);
  }
  ctx.lineTo(x0 + 1.5, r);
  ctx.quadraticCurveTo(x0, r, x0, r - 1.5);
  ctx.lineTo(x0, -r + 1.5);
  ctx.quadraticCurveTo(x0, -r, x0 + 1.5, -r);
  ctx.closePath();
  ctx.fill();

  // The extractor groove behind the rim, and the edge of the mouth.
  ctx.fillStyle = "rgb(0 0 0 / 0.3)";
  ctx.fillRect(x0 + 2.4, -r + 1, 1.6, dia - 2);
  ctx.fillStyle = "rgb(255 255 255 / 0.35)";
  const mouth = kind === "9mm" ? r - 0.5 : 3.4;
  ctx.fillRect(x1 - 1, -mouth, 1, mouth * 2);
}

/**
 * The range card's background: strings of shots, each a blink of light over
 * the card and a spent case that tumbles in from the top right and piles up
 * at the bottom, behind the text. A click fires
 * a few more. Off screen it pauses; with reduced motion it is a still pile.
 */
function createRange(M: Matter, canvas: HTMLCanvasElement, reduced: boolean) {
  const engine = M.Engine.create({ gravity: { x: 0, y: 1, scale: 0.0012 } });
  const wall = { isStatic: true, friction: 0.8, restitution: 0.2 };
  const floor = M.Bodies.rectangle(0, 0, 4000, 60, wall);
  const left = M.Bodies.rectangle(0, 0, 60, 4000, wall);
  const right = M.Bodies.rectangle(0, 0, 60, 4000, wall);
  M.Composite.add(engine.world, [floor, left, right]);

  const ctx = canvas.getContext("2d")!;
  const casings: Casing[] = [];
  let w = 0;
  let h = 0;
  let raf = 0;
  let queued = 0;
  let nextShot = 0;
  let last = 0;
  let carry = 0;
  let flashAt = -Infinity;
  const pending: number[] = [];

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    M.Body.setPosition(floor, { x: w / 2, y: h + 30 });
    M.Body.setPosition(left, { x: -30, y: h / 2 });
    M.Body.setPosition(right, { x: w + 30, y: h / 2 });
  };

  const eject = (now: number, x = w - 24 - Math.random() * 36, y = -16) => {
    const kind: Kind = Math.random() < 0.5 ? "9mm" : "762";
    const [len, dia] = SIZE[kind];
    const body = M.Bodies.rectangle(x, y, len, dia, {
      chamfer: { radius: 3 },
      restitution: 0.32,
      friction: 0.55,
      frictionStatic: 0.9,
      frictionAir: 0.012,
      density: 0.004,
      angle: Math.random() * Math.PI,
    });
    M.Body.setVelocity(body, { x: -(1.5 + Math.random() * 3.5), y: 1 + Math.random() * 2 });
    M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.6);
    M.Composite.add(engine.world, body);
    casings.push({ body, kind });
    // Past the cap the oldest fade away instead of piling up forever.
    const alive = casings.filter((c) => c.dyingAt === undefined);
    if (alive.length > MAX) alive[0].dyingAt = now;
  };

  const draw = (now: number) => {
    ctx.clearRect(0, 0, w, h);
    const flash = 1 - (now - flashAt) / FLASH_MS;
    if (flash > 0) {
      ctx.fillStyle = `rgb(255 248 225 / ${0.35 * flash})`;
      ctx.fillRect(0, 0, w, h);
    }
    for (let i = casings.length - 1; i >= 0; i--) {
      const c = casings[i];
      const fade = c.dyingAt === undefined ? 1 : 1 - (now - c.dyingAt) / FADE_MS;
      if (fade <= 0 || c.body.position.y > h + 120) {
        M.Composite.remove(engine.world, c.body);
        casings.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(c.body.position.x, c.body.position.y);
      ctx.rotate(c.body.angle);
      drawCasing(ctx, c.kind);
      ctx.restore();
    }
  };

  const frame = (now: number) => {
    if (now >= nextShot) {
      if (queued === 0) queued = 3 + Math.floor(Math.random() * 5);
      flashAt = now;
      pending.push(now + EJECT_DELAY);
      queued -= 1;
      // A string of shots, then a breath before the next one.
      nextShot = now + (queued > 0 ? 130 + Math.random() * 110 : 1300 + Math.random() * 1500);
    }
    while (pending.length && pending[0] <= now) {
      pending.shift();
      eject(now);
    }
    // Fixed steps keep the pile steady whatever the frame rate.
    carry = Math.min(carry + now - last, STEP * 4);
    last = now;
    while (carry >= STEP) {
      M.Engine.update(engine, STEP);
      carry -= STEP;
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  };

  return {
    resize,
    start() {
      if (reduced) {
        // A still pile: drop a handful and let them settle before showing anything.
        if (!casings.length) {
          for (let i = 0; i < 18; i++) eject(0, 20 + Math.random() * (w - 40), -20 - i * 14);
          for (let i = 0; i < 600; i++) M.Engine.update(engine, STEP);
        }
        draw(0);
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
    },
    /** A few shots right now, on top of whatever string is running. */
    fire(n: number) {
      if (reduced) return;
      queued += n;
      nextShot = 0;
    },
  };
}

export function Casings() {
  const ref = useRef<HTMLCanvasElement>(null);
  const range = useRef<ReturnType<typeof createRange> | null>(null);
  const inView = useInView(ref, { margin: "120px 0px" });
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const canvas = ref.current;
    if (!inView || !canvas) return;
    let alive = true;
    let observer: ResizeObserver | undefined;
    // The card itself is the trigger: the canvas sits behind its text.
    const card = canvas.parentElement;
    const onDown = () => range.current?.fire(4);

    import("matter-js").then(({ default: M }) => {
      if (!alive) return;
      range.current ??= createRange(M, canvas, reduced);
      const r = range.current;
      r.resize();
      observer = new ResizeObserver(() => r.resize());
      observer.observe(canvas);
      card?.addEventListener("pointerdown", onDown);
      r.start();
    });
    return () => {
      alive = false;
      observer?.disconnect();
      card?.removeEventListener("pointerdown", onDown);
      range.current?.stop();
    };
  }, [inView, reduced]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}
