"use client";

import { useInView } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Calendar } from "@/lib/api/generated/Calendar";
import { fmt, plural, t } from "@/lib/copy";
import { viewport } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Empty, then four steps from the Numbers gradient. */
const LEVELS = ["#1c1c1f", "#0f3d3a", "#14776b", "#2fb9a2", "#5ef0c2"];
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Day = { date: Date; count: number; level: number };

/** Quartiles of the days with any work, like GitHub's own scale. */
function levels(days: number[]) {
  const active = days.filter((n) => n > 0).sort((a, b) => a - b);
  const q = (f: number) => active[Math.floor((active.length - 1) * f)] ?? 1;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return (n: number) => (n === 0 ? 0 : 1 + cuts.filter((c) => n > c).length);
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The last year of commits as GitHub draws it: a column per week, Sunday on
 * top. The weeks light up left to right as it scrolls into view.
 */
export function ContributionCalendar({ calendar }: { calendar: Calendar }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const shown = useInView(ref, viewport);
  const [hover, setHover] = useState<Day | null>(null);

  const weeks = useMemo(() => {
    const start = Date.parse(`${calendar.start}T00:00:00Z`);
    const level = levels(calendar.days);
    // Pad the first, usually partial, week so rows stay weekdays.
    const lead = new Date(start).getUTCDay();
    const cells: (Day | null)[] = [
      ...Array<null>(lead).fill(null),
      ...calendar.days.map((count, i) => ({ date: new Date(start + i * DAY_MS), count, level: level(count) })),
    ];
    const out: (Day | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [calendar]);

  // On a phone the grid scrolls sideways; start at this week.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  // A label per month where it starts, unless the next one is too close
  // (the partial first week usually is).
  const months = useMemo(() => {
    const starts = weeks.map((week, w) => {
      const first = week.find(Boolean);
      const prev = w > 0 ? weeks[w - 1].find(Boolean) : null;
      return first && (!prev || prev.date.getUTCMonth() !== first.date.getUTCMonth())
        ? MONTHS[first.date.getUTCMonth()]
        : null;
    });
    return starts.map((label, w) => {
      const next = starts.findIndex((l, i) => i > w && l);
      return label && (next < 0 || next - w >= 3) ? label : null;
    });
  }, [weeks]);

  const caption = hover
    ? hover.count
      ? fmt(plural(hover.count, t.calendar.day), { date: fmtDate(hover.date) })
      : fmt(t.calendar.none, { date: fmtDate(hover.date) })
    : t.calendar.hint;

  return (
    <div ref={ref} data-shown={shown || undefined} className="group/cal mt-8 flex w-full max-w-230 flex-col gap-3">
      <div ref={scroller} className="[scrollbar-width:none] overflow-x-auto pb-1">
        <div
          role="img"
          aria-label={fmt(t.calendar.label, { n: calendar.total.toLocaleString("en-US") })}
          className="mx-auto grid w-max grid-flow-col gap-[3px]"
          style={{ gridTemplateRows: "auto repeat(7, 13px)", gridAutoColumns: "13px" }}
          onPointerLeave={() => setHover(null)}
        >
          {weeks.map((week, w) => (
            <div key={w} className="contents">
              <span className="h-4 overflow-visible text-left text-[11px] leading-none whitespace-nowrap text-stage-dim">
                {months[w]}
              </span>
              {Array.from({ length: 7 }, (_, d) => {
                const day = week[d];
                if (!day) return <span key={d} />;
                return (
                  <span
                    key={d}
                    onPointerEnter={() => setHover(day)}
                    className={cn(
                      "size-[13px] scale-50 rounded-[3px] opacity-0 transition-[transform,opacity,box-shadow] duration-500 ease-(--motion-ease-out)",
                      "group-data-shown/cal:scale-100 group-data-shown/cal:opacity-100 hover:shadow-[0_0_0_1.5px_var(--stage-fg)]",
                    )}
                    style={{
                      background: LEVELS[day.level],
                      // The entrance waits its turn; the hover ring does not.
                      transitionDelay: `${w * 14 + d * 18}ms, ${w * 14 + d * 18}ms, 0ms`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-stage-dim">
        <span aria-live="polite" className="tabular-nums">
          {caption}
        </span>
        <span className="flex items-center gap-1.5">
          {t.calendar.less}
          {LEVELS.map((c) => (
            <i key={c} className="size-[11px] rounded-[3px]" style={{ background: c }} />
          ))}
          {t.calendar.more}
        </span>
      </div>
    </div>
  );
}
