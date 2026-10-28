"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { CountUp } from "@/components/sections/work/keynote";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmt, plural, t } from "@/lib/copy";
import type { Title } from "@/lib/api/generated/Title";
import type { WatchedPage } from "@/lib/api/generated/WatchedPage";
import { ease, rise, spring, stagger, viewport } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  adminApi,
  adminHint,
  adminToken,
  type Credential,
  errorKey,
  fmtScore,
  fmtWhen,
  posterUrl,
  tier,
  whenKey,
} from "@/lib/watched";

import { AdminDialog } from "./admin-dialog";
import { TitleForm } from "./title-form";

const FILTERS = ["all", "movie", "series", "watching", "want"] as const;
type Filter = (typeof FILTERS)[number];

const SORTS = ["recent", "best", "worst", "title"] as const;
type Sort = (typeof SORTS)[number];

/** Unscored titles go last whichever way the scores are sorted. */
const score = (x: Title, missing: number) => x.rating ?? missing;

const sorters: Record<Sort, (a: Title, b: Title) => number> = {
  recent: (a, b) => whenKey(b.watched) - whenKey(a.watched) || b.createdAt - a.createdAt,
  best: (a, b) => score(b, -1) - score(a, -1) || a.title.localeCompare(b.title),
  worst: (a, b) => score(a, 11) - score(b, 11) || a.title.localeCompare(b.title),
  title: (a, b) => a.title.localeCompare(b.title),
};

function useMeta() {
  return (x: Title) =>
    [
      x.kind === "series"
        ? `${t.watched.kind.series}${x.seasons ? ` · ${fmt(t.watched.seasonsShort, { s: x.seasons })}` : ""}`
        : t.watched.kind.movie,
      x.year,
    ]
      .filter(Boolean)
      .join(" · ");
}

export function WatchedView({ page, initial }: { page: WatchedPage; initial: Title[] | null }) {
  const [items, setItems] = useState<Title[]>(initial ?? []);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [q, setQ] = useState("");
  // Signed in either with the admin token (kept here) or a passkey session
  // (an HttpOnly cookie the browser sends itself, so `token` stays null).
  const [admin, setAdmin] = useState(false);
  const [token, setToken] = useState<Credential>(null);
  const [editing, setEditing] = useState<Title | "new" | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  // Already signed in on this device? Re-check quietly.
  useEffect(() => {
    const saved = adminToken.get();
    adminApi.check(saved).then(
      () => {
        setToken(saved);
        setAdmin(true);
        adminHint.set(true);
      },
      () => {
        adminToken.set(null);
        adminHint.set(false);
      },
    );
  }, []);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const stats = useMemo(() => {
    // "Want to watch" is a wish list: it counts in the filters, not the scores.
    const seen = items.filter((i) => i.status !== "want");
    const rated = seen.filter((i): i is Title & { rating: number } => i.rating !== null);
    // 7.5 lands in the 7 bar.
    const hist = Array.from({ length: 10 }, (_, k) => rated.filter((i) => Math.floor(i.rating) === k + 1).length);
    return {
      seen: seen.length,
      movies: seen.filter((i) => i.kind === "movie").length,
      series: seen.filter((i) => i.kind === "series").length,
      watching: items.filter((i) => i.status === "watching").length,
      want: items.length - seen.length,
      tens: rated.filter((i) => i.rating === 10).length,
      avg: rated.length ? rated.reduce((s, i) => s + i.rating, 0) / rated.length : 0,
      hist,
      max: Math.max(1, ...hist),
      best: rated.toSorted((a, b) => b.rating - a.rating || whenKey(b.watched) - whenKey(a.watched))[0],
    };
  }, [items]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items
      .filter(
        (i) =>
          filter === "all" || (filter === "watching" || filter === "want" ? i.status === filter : i.kind === filter),
      )
      .filter((i) => !ql || i.title.toLowerCase().includes(ql) || i.note.toLowerCase().includes(ql))
      .toSorted(sorters[sort]);
  }, [items, filter, sort, q]);

  const counts: Record<Filter, number> = {
    all: items.length,
    movie: stats.movies,
    series: stats.series,
    watching: stats.watching,
    want: stats.want,
  };

  const saved = (x: Title) => {
    setItems((list) => [x, ...list.filter((i) => i.id !== x.id)]);
    toast(editing === "new" ? fmt(t.watched.added, { title: x.title }) : t.watched.saved);
    setEditing(null);
  };

  const remove = async (x: Title) => {
    if (!admin) return;
    if (armed !== x.id) return setArmed(x.id);
    setArmed(null);
    try {
      await adminApi.remove(token, x.id);
      setItems((list) => list.filter((i) => i.id !== x.id));
      toast(fmt(t.watched.deleted, { title: x.title }));
    } catch (err) {
      toast(t.watched.errors[errorKey(err, t.watched.errors)]);
    }
  };

  return (
    <>
      <section className="wrap flex flex-col items-center gap-4.5 py-[clamp(72px,10vw,140px)] text-center">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: ease.out }}
          className="text-eyebrow font-semibold text-stage-dim"
        >
          {page.eyebrow}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 24, scale: 0.97, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: 1.2, ease: ease.out }}
          className="gradient-text pb-[0.06em] text-[clamp(64px,14vw,200px)] leading-[0.92] font-bold tracking-[-0.065em] [--g:var(--title-gradient)]"
        >
          {page.title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="text-[clamp(28px,4.4vw,58px)] leading-[1.06] font-semibold tracking-[-0.04em]"
        >
          {plural(stats.seen, t.watched.titles)}
          <br />
          <span className="text-stage-dim">
            {stats.avg
              ? fmt(t.watched.average, {
                  avg: stats.avg.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                })
              : t.watched.scored}
          </span>
        </motion.p>

        <motion.div
          initial="hidden"
          animate="shown"
          variants={stagger(0.08, 0.5)}
          className="mt-5.5 grid w-full max-w-190 grid-cols-1 gap-6 border-t border-stage-frame pt-6.5 sm:grid-cols-3"
        >
          {(
            [
              [stats.movies, t.watched.movies],
              [stats.series, t.watched.series],
              [stats.tens, t.watched.tens],
            ] as const
          ).map(([n, label]) => (
            <motion.div key={label} variants={rise}>
              <CountUp value={String(n)} className="block text-trio font-bold tracking-[-0.05em]" />
              <span className="text-sm text-stage-dim">{label}</span>
            </motion.div>
          ))}
        </motion.div>

        <Histogram hist={stats.hist} max={stats.max} />
      </section>

      {stats.best && <Spotlight best={stats.best} />}

      <section className="wrap pb-[clamp(64px,9vw,120px)]">
        <div className="flex flex-wrap items-center justify-between gap-3.5 pt-2">
          <div
            role="group"
            aria-label={t.watched.show}
            className="flex flex-wrap gap-1 rounded-pill bg-stage-tile p-1.25"
          >
            {FILTERS.map((id) => {
              const on = filter === id;
              return (
                <button
                  key={id}
                  aria-pressed={on}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "relative min-h-9.5 rounded-pill px-3.75 text-sm font-medium transition-colors",
                    on ? "text-stage-on-fg" : "text-stage-chip hover:text-stage-fg",
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="watched-filter"
                      transition={spring.layout}
                      className="absolute inset-0 rounded-pill bg-stage-fg"
                    />
                  )}
                  <span className="relative">
                    {t.watched.filters[id]}
                    <span className="ml-1.25 tabular-nums opacity-60">{counts[id]}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto">
            <label className="sr-only" htmlFor="watched-q">
              {t.watched.search}
            </label>
            <input
              id="watched-q"
              type="search"
              placeholder={t.watched.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-stage-frame bg-stage-tile px-3.5 text-[15px] text-stage-fg placeholder:text-stage-dim md:w-57.5"
            />
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger
                aria-label={t.watched.sortLabel}
                className="min-h-11 rounded-xl border-stage-frame bg-stage-tile px-3.5 text-[15px] text-stage-fg data-[size=default]:h-11 [&_svg]:text-stage-dim"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                position="popper"
                align="end"
                className="rounded-2xl border border-stage-frame bg-stage-tile p-1 font-stage text-stage-fg ring-0"
              >
                {SORTS.map((k) => (
                  <SelectItem
                    key={k}
                    value={k}
                    className="rounded-xl py-2.5 pr-8 pl-3 text-[15px] focus:bg-stage-frame focus:text-stage-fg"
                  >
                    {t.watched.sort[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {admin && !editing && (
              <Button variant="pill" size="pill" onClick={() => setEditing("new")}>
                {t.watched.add}
              </Button>
            )}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {admin && editing && (
            <TitleForm
              key={editing === "new" ? "new" : editing.id}
              token={token}
              editing={editing}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          )}
        </AnimatePresence>

        {initial === null && <Blank title={t.watched.unavailable} body={t.watched.tryLater} />}
        {initial !== null && items.length === 0 && (
          <Blank title={page.emptyTitle} body={admin ? t.watched.addFirst : page.emptyBody} />
        )}
        {items.length > 0 && shown.length === 0 && <Blank title={t.watched.noMatches} body={t.watched.noMatchesBody} />}

        {shown.length > 0 && (
          <LayoutGroup>
            <motion.ol layout className="mt-7 border-t border-stage-frame">
              <AnimatePresence initial={false} mode="popLayout">
                {shown.map((x, i) => (
                  <Credit
                    key={x.id}
                    x={x}
                    index={i}
                    admin={admin}
                    armed={armed === x.id}
                    onEdit={() => setEditing(x)}
                    onRemove={() => remove(x)}
                  />
                ))}
              </AnimatePresence>
            </motion.ol>
          </LayoutGroup>
        )}
      </section>

      <footer className="border-t border-stage-rule">
        <div className="wrap flex flex-wrap justify-between gap-3 py-5 text-[12.5px] text-stage-dim">
          <span>© 2026 kewldan</span>
          {admin && <FindPosters token={token} onDone={setItems} />}
          <AdminDialog
            admin={admin}
            token={token}
            onSignIn={(next) => {
              setToken(next);
              adminToken.set(next);
              adminHint.set(true);
              setAdmin(true);
            }}
            onSignOut={() => {
              setToken(null);
              adminToken.set(null);
              adminHint.set(false);
              setAdmin(false);
              setEditing(null);
            }}
          />
        </div>
      </footer>
    </>
  );
}

/** Scores 1–10 as bars that grow in once, coloured by tier. */
function Histogram({ hist, max }: { hist: number[]; max: number }) {
  return (
    <div
      className="mt-7 flex w-full max-w-190 flex-col gap-2.5"
      aria-label={`${t.watched.spread}: ${hist.map((n, k) => `${k + 1}: ${n}`).join(", ")}`}
    >
      <div aria-hidden className="grid h-22.5 grid-cols-10 items-end gap-1.25 md:h-30 md:gap-2">
        {hist.map((n, k) => (
          <motion.i
            key={k}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.8, ease: ease.out, delay: 0.6 + k * 0.04 }}
            className="block min-h-0.75 origin-bottom rounded-t-lg rounded-b-[3px]"
            style={{ height: `${(n / max) * 100}%`, background: n ? tier(k + 1).gradient : "var(--stage-frame)" }}
          />
        ))}
      </div>
      <div aria-hidden className="grid grid-cols-10 gap-1.25 text-[13px] text-stage-dim tabular-nums md:gap-2">
        {hist.map((_, k) => (
          <span key={k}>{k + 1}</span>
        ))}
      </div>
      <small className="text-[13px] text-stage-dim">{t.watched.howIScore}</small>
    </div>
  );
}

function Spotlight({ best }: { best: Title }) {
  const meta = useMeta();
  const glow = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--gx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };
  return (
    <section className="wrap flex flex-col items-center gap-4.5 pb-[clamp(72px,10vw,140px)] text-center">
      <p className="text-eyebrow font-semibold text-stage-dim">{t.watched.top}</p>
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={viewport}
        transition={{ duration: 1, ease: ease.out }}
        onPointerMove={glow}
        className="flex w-full max-w-245 flex-col items-center gap-3.5 rounded-device border border-stage-frame bg-[radial-gradient(700px_circle_at_var(--gx,50%)_var(--gy,0%),rgb(94_240_194/0.16),transparent_60%),var(--stage-device)] px-[clamp(20px,4vw,48px)] py-[clamp(28px,5vw,64px)] shadow-[0_40px_120px_rgb(63_182_255/0.12)]"
      >
        <div style={{ ["--g" as string]: tier(best.rating).gradient }}>
          <CountUp
            value={fmtScore(best.rating)}
            className="gradient-text pb-[0.04em] text-[clamp(96px,16vw,200px)] leading-[0.85] font-bold tracking-[-0.07em]"
          />
        </div>
        <h2 className="text-[clamp(32px,5vw,64px)] leading-none font-bold tracking-[-0.05em] [overflow-wrap:anywhere]">
          {best.title}
        </h2>
        <p className="max-w-[46ch] text-[clamp(16px,1.7vw,20px)] leading-[1.45] text-stage-dim">
          {meta(best)} · {fmt(t.watched.watchedOn, { date: fmtWhen(best.watched) })}
        </p>
        {best.note && <p className="max-w-[46ch] text-[clamp(16px,1.7vw,20px)] text-stage-note">{best.note}</p>}
      </motion.div>
    </section>
  );
}

function Credit({
  x,
  index,
  admin,
  armed,
  onEdit,
  onRemove,
}: {
  x: Title;
  index: number;
  admin: boolean;
  armed: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const meta = useMeta();
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: ease.out, delay: Math.min(index, 10) * 0.03 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={spring.layout}
      className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 rounded-sm border-b border-stage-frame px-2 py-6 transition-colors hover:bg-stage-device md:grid-cols-[120px_minmax(0,1fr)_110px_auto] md:items-center md:gap-6"
    >
      <p
        className="gradient-text pb-[0.04em] text-right text-[52px] leading-[0.9] font-bold tracking-[-0.07em] tabular-nums md:text-[clamp(52px,6vw,80px)]"
        style={{ ["--g" as string]: tier(x.rating).gradient }}
        aria-label={x.rating === null ? t.watched.noScore : fmt(t.watched.scoreLabel, { n: x.rating })}
      >
        {fmtScore(x.rating)}
      </p>
      <div className="flex min-w-0 gap-4">
        {x.poster && (
          <Image
            src={posterUrl(x.poster)}
            alt=""
            width={56}
            height={84}
            sizes="56px"
            className="h-21 w-14 shrink-0 rounded-md object-cover ring-1 ring-white/10"
          />
        )}
        <div className="min-w-0">
          <h3 className="text-[clamp(22px,2.6vw,32px)] leading-[1.1] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere]">
            {x.title}
          </h3>
          <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-sm text-stage-dim">
            <span>{meta(x)}</span>
            {x.status === "watching" && <span className="text-[#e0a800]">{t.watched.watchingNow}</span>}
            {x.status === "paused" && <span className="text-[#e0a800]">{t.watched.paused}</span>}
            {x.status === "dropped" && <span className="text-[#ff453a]">{t.watched.dropped}</span>}
            {x.status === "want" && <span className="text-stage-link">{t.watched.wantTag}</span>}
          </p>
          {x.note && <p className="mt-2 max-w-[62ch] text-base leading-[1.45] text-stage-note">{x.note}</p>}
        </div>
      </div>
      <p className="col-start-2 font-mono text-[12.5px] text-stage-dim tabular-nums md:col-start-auto md:text-right">
        {fmtWhen(x.watched)}
      </p>
      <div className="col-start-2 flex gap-0.5 md:col-start-auto md:justify-end">
        {admin && (
          <>
            <button onClick={onEdit} className="min-h-10 px-2 text-sm text-stage-link hover:underline">
              {t.watched.editAction}
            </button>
            <button
              onClick={onRemove}
              className={cn(
                "min-h-10 px-2 text-sm hover:underline",
                armed ? "font-semibold text-[#ff453a]" : "text-stage-link",
              )}
            >
              {armed ? t.watched.sure : t.watched.deleteAction}
            </button>
          </>
        )}
      </div>
    </motion.li>
  );
}

/** Admin only: a TMDB poster for every title that has none yet. */
function FindPosters({ token, onDone }: { token: Credential; onDone: (items: Title[]) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { filled, missed } = await adminApi.findPosters(token);
      toast(fmt(plural(filled, t.watched.postersFound), { n: filled }), {
        description: missed.length ? fmt(t.watched.postersMissed, { titles: missed.join(", ") }) : undefined,
      });
      const res = await fetch("/api/watched", { cache: "no-store" });
      if (res.ok) onDone(((await res.json()) as { items: Title[] }).items);
    } catch {
      toast(t.watched.postersFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={run} disabled={busy} className="text-stage-chip hover:text-stage-fg disabled:opacity-60">
      {busy ? t.watched.findingPosters : t.watched.findPosters}
    </button>
  );
}

function Blank({ title, body }: { title: string; body: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: ease.out }}
      className="mt-7 flex flex-col items-center gap-3.5 rounded-[28px] bg-stage-tile px-6 py-[clamp(36px,6vw,72px)] text-center"
    >
      <h3 className="text-[clamp(28px,4vw,48px)] font-bold tracking-[-0.045em]">{title}</h3>
      <p className="max-w-[48ch] text-md leading-normal text-stage-dim">{body}</p>
    </motion.div>
  );
}
