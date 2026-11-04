"use client";

import { useMotionValue, useReducedMotion, useSpring } from "motion/react";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";

import { Reveal } from "@/components/motion/reveal";
import type { Wallet } from "@/lib/api/generated/Wallet";
import type { Copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

import { Stage } from "../work/stage";
import { ICONS, type IconKey } from "./icons";
import { COINS, NETS, type CoinId, type NetId } from "./wallets";

function Icon({ k, className }: { k: IconKey; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block shrink-0 leading-none [&>svg]:block [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: ICONS[k] }}
    />
  );
}

/** The QR as one path; the modules under the centre mark are left out. */
function Qr({ text, label, hole = 0.3 }: { text: string; label: string; hole?: number }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, "H");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const h0 = Math.floor(n * (0.5 - hole / 2));
    const h1 = Math.ceil(n * (0.5 + hole / 2));
    let d = "";
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (r >= h0 && r < h1 && c >= h0 && c < h1) continue;
        if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    return { d, n };
  }, [text, hole]);
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className="block size-full"
    >
      <path d={d} fill="#0d0d0f" />
    </svg>
  );
}

// x, y in % of the slide; s size in px; d depth from 0 (far, blurred) to 1
// (near, sharp); r tilt; the coin it lights up with.
const FLOAT: { k: IconKey; id: CoinId; x: number; y: number; s: number; d: number; r: number }[] = [
  { k: "bg-usdt", id: "usdt", x: 7, y: 16, s: 104, d: 0.85, r: -12 },
  { k: "bg-ethereum", id: "eth", x: 87, y: 13, s: 76, d: 0.55, r: 10 },
  { k: "bg-ton", id: "ton", x: 91, y: 60, s: 116, d: 0.95, r: 8 },
  { k: "bg-usdt", id: "usdt", x: 4, y: 66, s: 88, d: 0.65, r: -7 },
  { k: "bg-ethereum", id: "eth", x: 80, y: 89, s: 60, d: 0.35, r: 14 },
  { k: "bg-tron", id: "usdt", x: 17, y: 90, s: 50, d: 0.25, r: -18 },
  { k: "bg-ethereum", id: "eth", x: 66, y: 5, s: 40, d: 0.15, r: 20 },
  { k: "bg-ton", id: "ton", x: 28, y: 6, s: 46, d: 0.2, r: -8 },
  { k: "bg-usdt", id: "usdt", x: 96, y: 36, s: 36, d: 0.1, r: 16 },
  { k: "bg-ethereum", id: "eth", x: 13, y: 44, s: 34, d: 0.1, r: -20 },
  { k: "bg-ton", id: "ton", x: 36, y: 94, s: 30, d: 0.05, r: 6 },
];

function Backdrop({ active }: { active: CoinId }) {
  return (
    <div className="cx-bg" aria-hidden>
      <div className="cx-grid" />
      <svg className="cx-geo cx-rings" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="98" />
        <circle cx="100" cy="100" r="74" strokeDasharray="1 5" />
        <circle cx="100" cy="100" r="50" />
      </svg>
      <svg className="cx-geo cx-oct" viewBox="0 0 100 160">
        <path d="M50 2 98 80 50 158 2 80Z M50 2 50 158 M2 80 98 80 M50 2 70 80 50 158 30 80Z" />
      </svg>
      <svg className="cx-geo cx-hex" viewBox="0 0 100 100">
        <path d="M50 3 91 26.5 91 73.5 50 97 9 73.5 9 26.5Z M50 3 50 50 M91 73.5 50 50 M9 73.5 50 50" />
      </svg>
      <svg className="cx-geo cx-cube" viewBox="0 0 100 100">
        <path d="M50 6 90 28 90 72 50 94 10 72 10 28Z M10 28 50 50 90 28 M50 50 50 94" />
      </svg>
      {FLOAT.map((f, i) => (
        <span
          key={i}
          className={cn("cx-float", f.id === active && "cx-on")}
          style={
            {
              left: `${f.x}%`,
              top: `${f.y}%`,
              "--s": `${f.s}px`,
              "--d": f.d,
              "--r": `${f.r}deg`,
              "--t": `${7 + (i % 4) * 1.7}s`,
              "--dl": `${-i * 1.3}s`,
            } as React.CSSProperties
          }
        >
          <Icon k={f.k} />
        </span>
      ))}
    </div>
  );
}

/**
 * The pointer's offset from the slide's centre, -1..1, eased by a spring
 * and written as CSS variables, so the backdrop glides after the mouse
 * and nothing re-renders.
 */
function useParallax(ref: React.RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const spring = { stiffness: 50, damping: 18, mass: 1 };
  const sx = useSpring(mx, spring);
  const sy = useSpring(my, spring);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const offX = sx.on("change", (v) => el.style.setProperty("--mx", v.toFixed(4)));
    const offY = sy.on("change", (v) => el.style.setProperty("--my", v.toFixed(4)));
    return () => {
      offX();
      offY();
    };
  }, [ref, reduced, sx, sy]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onPointerLeave = () => {
    mx.set(0);
    my.set(0);
  };
  return { onPointerMove, onPointerLeave };
}

const chunks = (a: string) => a.match(/.{1,4}/g) ?? [];

/** The coins that have at least one address, each with its addresses. */
function withAddresses(wallets: Wallet[]) {
  return COINS.flatMap((c) => {
    const nets = c.nets.flatMap((net: NetId) => {
      const addr = wallets.find((w) => w.coin === c.id && w.net === net)?.addr;
      return addr ? [{ net, addr }] : [];
    });
    return nets.length ? [{ ...c, nets }] : [];
  });
}

/** Renders nothing until the admin sets an address. */
export function Crypto({ t, wallets }: { t: Copy["crypto"]; wallets: Wallet[] }) {
  const coins = useMemo(() => withAddresses(wallets), [wallets]);
  return coins.length ? <Slide t={t} coins={coins} /> : null;
}

function Slide({ t, coins }: { t: Copy["crypto"]; coins: ReturnType<typeof withAddresses> }) {
  const [coinId, setCoinId] = useState<CoinId>(coins.find((c) => c.id === "usdt")?.id ?? coins[0].id);
  const [netIndex, setNetIndex] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const parallax = useParallax(ref);

  const coin = coins.find((c) => c.id === coinId) ?? coins[0];
  const pick = coin.nets[Math.min(netIndex, coin.nets.length - 1)];
  const hint = t.hints[`${coin.id}-${pick.net}`];

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pick.addr);
      setCopied(pick.addr);
    } catch {
      // No clipboard (an old browser, a denied permission): the address is
      // still on screen to select.
    }
  };
  const isCopied = copied === pick.addr;

  return (
    <Stage id="crypto" seamless>
      <div
        ref={ref}
        {...parallax}
        className="cx-root"
        style={{ "--glow": coin.glow, "--tint": coin.tint } as React.CSSProperties}
      >
        <Backdrop active={coin.id} />
        <div className="relative z-1 wrap flex flex-col items-center gap-4.5 py-slide text-center">
          <Reveal>
            <p className="text-eyebrow font-semibold text-stage-dim">{t.eyebrow}</p>
          </Reveal>
          <Reveal>
            <h2 className="text-[clamp(42px,7vw,104px)] leading-none font-bold tracking-[-0.055em] text-balance">
              {t.title} <span className="text-stage-dim">{t.titleDim}</span>
            </h2>
          </Reveal>
          <Reveal>
            <p className="max-w-[44ch] text-sub font-medium text-stage-dim">{t.sub}</p>
          </Reveal>

          <div role="group" aria-label={t.coin} className="mt-4 flex flex-wrap justify-center gap-1 md:gap-2.5">
            {coins.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === coin.id}
                onClick={() => {
                  setCoinId(c.id);
                  setNetIndex(0);
                }}
                style={{ "--glow": c.glow } as React.CSSProperties}
                className={cn(
                  "cx-coin",
                  "flex w-16 flex-col items-center gap-2 rounded-2xl px-0 py-2 text-[13px] font-semibold text-stage-dim transition-colors aria-pressed:text-stage-fg md:w-22 md:px-1.5",
                )}
              >
                <Icon k={c.icon} className="size-12 overflow-hidden rounded-[14px] md:size-14 md:rounded-2xl" />
                {c.sym}
              </button>
            ))}
          </div>

          <div
            className={cn(
              "cx-card",
              "relative mt-5 grid w-full max-w-220 grid-cols-1 items-center justify-items-center gap-[clamp(20px,3vw,36px)] overflow-hidden rounded-[30px] bg-stage-tile p-[clamp(16px,2.4vw,28px)] text-left md:grid-cols-[auto_minmax(0,1fr)] md:justify-items-stretch",
            )}
          >
            <div className="relative aspect-square w-[clamp(180px,24vw,240px)] shrink-0 rounded-[22px] bg-white p-3.5">
              <Qr text={pick.addr} label={t.qr.replace("{coin}", coin.sym)} />
              <Icon
                k={coin.icon}
                className="absolute top-1/2 left-1/2 size-[22%] -translate-1/2 overflow-hidden rounded-[10px] shadow-[0_0_0_5px_#fff]"
              />
            </div>

            <div className="relative flex w-full min-w-0 flex-col gap-3.5">
              <h3 className="text-[clamp(28px,3.4vw,44px)] leading-none font-bold tracking-[-0.045em]">
                {coin.name} <span className="text-stage-dim">{coin.sym}</span>
              </h3>
              <div
                role="group"
                aria-label={t.network}
                className="inline-flex flex-wrap gap-1 self-start rounded-pill bg-black p-1"
              >
                {coin.nets.map((n, i) => (
                  <button
                    key={n.net}
                    type="button"
                    aria-pressed={n === pick}
                    disabled={coin.nets.length === 1}
                    onClick={() => setNetIndex(i)}
                    className="inline-flex items-center gap-1.5 rounded-pill py-1.5 pr-3 pl-1.75 text-[13.5px] font-semibold text-stage-dim transition-colors aria-pressed:bg-[#2c2c2e] aria-pressed:text-stage-fg"
                  >
                    <Icon k={NETS[n.net].icon} className="size-4.5" />
                    {NETS[n.net].name}
                  </button>
                ))}
              </div>
              <p
                aria-label={pick.addr}
                className={cn(
                  "cx-addr",
                  "font-mono text-[clamp(14px,1.5vw,17px)] leading-[1.6] tracking-normal break-all",
                )}
              >
                {chunks(pick.addr).map((c, i) => (
                  <span key={i} aria-hidden>
                    {c}
                  </span>
                ))}
              </p>
              {hint && (
                <p className="flex items-start gap-2 text-[13.5px] leading-[1.4] text-[#ffb547]">
                  <span aria-hidden>⚠</span>
                  {hint}
                </p>
              )}
              <button
                type="button"
                onClick={copy}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 self-start rounded-pill px-5.5 text-base font-medium transition-colors",
                  isCopied ? "bg-[#30d158] text-black" : "bg-stage-cta text-white hover:brightness-110",
                )}
              >
                {isCopied ? t.copied : t.copy}
              </button>
              <span className="sr-only" aria-live="polite">
                {isCopied ? t.copiedLive : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}
