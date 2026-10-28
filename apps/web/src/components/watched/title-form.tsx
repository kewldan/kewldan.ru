"use client";

import { CalendarIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { enUS } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmt, t } from "@/lib/copy";
import type { Kind } from "@/lib/api/generated/Kind";
import type { Title } from "@/lib/api/generated/Title";
import type { TitleInput } from "@/lib/api/generated/TitleInput";
import type { WatchStatus } from "@/lib/api/generated/WatchStatus";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { adminApi, type Credential, errorKey, tier } from "@/lib/watched";

const KINDS: Kind[] = ["movie", "series"];
const STATUSES: WatchStatus[] = ["watched", "watching", "dropped"];

/** `YYYY-MM-DD` in local time, the format the API stores. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIsoDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};

const field = "flex min-w-0 flex-col gap-2";
const label = "text-[13px] font-medium text-stage-dim";
const input =
  "min-h-11 w-full rounded-xl border border-stage-frame bg-stage-input px-3.5 text-[15px] text-stage-fg placeholder:text-stage-dim";

type Props = {
  token: Credential;
  editing: Title | "new";
  onSaved: (t: Title) => void;
  onCancel: () => void;
};

export function TitleForm({ token, editing, onSaved, onCancel }: Props) {
  const f = t.watched.form;
  const [form, setForm] = useState<Omit<TitleInput, "year"> & { year: string }>(() =>
    editing === "new"
      ? {
          title: "",
          kind: "movie",
          year: "",
          rating: 0,
          status: "watched",
          seasons: "",
          note: "",
          watched: isoDay(new Date()),
        }
      : { ...editing, year: editing.year ? String(editing.year) : "" },
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!form.title.trim()) return setErr(t.watched.errors.title);
    if (!form.rating) return setErr(t.watched.errors.rating);
    const year = Number.parseInt(form.year, 10);
    const body: TitleInput = { ...form, year: Number.isFinite(year) ? year : null };
    setBusy(true);
    setErr("");
    try {
      onSaved(editing === "new" ? await adminApi.create(token, body) : await adminApi.update(token, editing.id, body));
    } catch (error) {
      setErr(t.watched.errors[errorKey(error, t.watched.errors)]);
    } finally {
      setBusy(false);
    }
  };

  const picked = fromIsoDay(form.watched);

  return (
    <motion.form
      ref={ref}
      onSubmit={submit}
      aria-label={editing === "new" ? t.watched.add : t.watched.edit}
      initial={{ opacity: 0, height: 0, marginTop: 0 }}
      animate={{ opacity: 1, height: "auto", marginTop: 22 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.45, ease: ease.out }}
      className="overflow-hidden"
    >
      <div className="grid grid-cols-1 gap-4.5 rounded-[28px] border border-stage-frame bg-stage-tile p-[clamp(18px,3vw,32px)] text-left md:grid-cols-12">
        <h3 className="text-[clamp(24px,2.6vw,32px)] font-bold tracking-[-0.04em] md:col-span-12">
          {editing === "new" ? t.watched.add : t.watched.edit}
        </h3>

        <div className={cn(field, "md:col-span-6")}>
          <label htmlFor="f-title" className={label}>
            {f.title}
          </label>
          <input
            id="f-title"
            className={input}
            value={form.title}
            maxLength={160}
            autoComplete="off"
            placeholder={f.titlePlaceholder}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className={cn(field, "md:col-span-3")}>
          <span className={label} id="f-kind">
            {f.type}
          </span>
          <Segmented
            id="kind"
            labelledBy="f-kind"
            value={form.kind}
            options={KINDS.map((k) => [k, t.watched.kind[k]])}
            onChange={(v) => set("kind", v)}
          />
        </div>
        <div className={cn(field, "md:col-span-3")}>
          <label htmlFor="f-year" className={label}>
            {f.year}
          </label>
          <input
            id="f-year"
            className={input}
            inputMode="numeric"
            maxLength={4}
            placeholder="2026"
            value={form.year}
            onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))}
          />
        </div>

        <div className={cn(field, "md:col-span-6")}>
          <span className={label} id="f-rate">
            {form.rating ? fmt(f.scoreValue, { n: form.rating }) : f.score}
          </span>
          <div role="radiogroup" aria-labelledby="f-rate" className="grid grid-cols-10 gap-1.5 md:gap-2">
            {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => {
              const on = n <= form.rating;
              return (
                <motion.button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={form.rating === n}
                  aria-label={fmt(f.outOf, { n })}
                  onClick={() => set("rating", n)}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.9 }}
                  transition={spring.press}
                  className={cn(
                    "aspect-square min-h-8 rounded-full border text-[15px] font-semibold transition-colors",
                    on ? "border-transparent text-black" : "border-stage-strong bg-stage-input text-stage-chip",
                  )}
                  style={on ? { background: tier(form.rating).solid } : undefined}
                >
                  {n}
                </motion.button>
              );
            })}
          </div>
        </div>
        <div className={cn(field, "md:col-span-6")}>
          <span className={label} id="f-status">
            {f.status}
          </span>
          <Segmented
            id="status"
            labelledBy="f-status"
            value={form.status}
            options={STATUSES.map((s) => [s, t.watched.status[s]])}
            onChange={(v) => set("status", v)}
          />
        </div>

        <div className={cn(field, "md:col-span-3")}>
          <span className={label} id="f-date">
            {f.watchedOn}
          </span>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger
              aria-labelledby="f-date"
              className={cn(input, "flex items-center justify-between gap-2 text-left")}
            >
              {picked
                ? picked.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })
                : f.pickDate}
              <CalendarIcon className="size-4 text-stage-dim" />
            </PopoverTrigger>
            <PopoverContent
              align="start"
              data-lenis-prevent
              className="w-auto rounded-2xl border border-stage-frame bg-stage-tile p-2 text-stage-fg ring-0"
            >
              <Calendar
                mode="single"
                selected={picked}
                defaultMonth={picked}
                onSelect={(d) => {
                  if (!d) return;
                  set("watched", isoDay(d));
                  setDateOpen(false);
                }}
                locale={enUS}
                disabled={{ after: new Date() }}
                className="bg-transparent font-stage"
              />
            </PopoverContent>
          </Popover>
        </div>
        {form.kind === "series" && (
          <div className={cn(field, "md:col-span-3")}>
            <label htmlFor="f-seasons" className={label}>
              {f.seasons}
            </label>
            <input
              id="f-seasons"
              className={input}
              maxLength={40}
              placeholder="1–3"
              value={form.seasons}
              onChange={(e) => set("seasons", e.target.value)}
            />
          </div>
        )}
        <div className={cn(field, form.kind === "series" ? "md:col-span-6" : "md:col-span-9")}>
          <label htmlFor="f-note" className={label}>
            {f.note}
          </label>
          <textarea
            id="f-note"
            className={cn(input, "min-h-21 resize-y py-3")}
            maxLength={400}
            placeholder={f.notePlaceholder}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 md:col-span-12">
          <Button type="submit" variant="pill" size="pill" disabled={busy}>
            {busy ? f.saving : editing === "new" ? f.addSubmit : f.saveSubmit}
          </Button>
          <button type="button" onClick={onCancel} className="min-h-11 px-2.5 text-stage-link hover:underline">
            {f.cancel}
          </button>
          {err && (
            <p role="alert" className="font-medium text-[#ff453a]">
              {err}
            </p>
          )}
        </div>
      </div>
    </motion.form>
  );
}

function Segmented<T extends string>({
  id,
  labelledBy,
  value,
  options,
  onChange,
}: {
  id: string;
  labelledBy: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex w-fit gap-1 rounded-pill bg-stage-input p-1.25">
      {options.map(([v, l]) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={cn(
              "relative min-h-9.5 rounded-pill px-3.75 text-sm font-medium",
              on ? "text-stage-on-fg" : "text-stage-chip",
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={spring.layout}
                className="absolute inset-0 rounded-pill bg-stage-fg"
              />
            )}
            <span className="relative">{l}</span>
          </button>
        );
      })}
    </div>
  );
}
