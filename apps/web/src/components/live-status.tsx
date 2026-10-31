"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { ru } from "date-fns/locale";
import { useEffect, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProbeStatus } from "@/lib/api/generated/ProbeStatus";
import { fmt } from "@/lib/copy";
import { useI18n } from "@/components/lang";
import { cn } from "@/lib/utils";

type Statuses = Record<string, ProbeStatus>;

let pending: Promise<Statuses> | null = null;

/** One request per page load, however many dots there are. */
function loadStatuses() {
  pending ??= fetch("/api/status")
    .then((res) => (res.ok ? (res.json() as Promise<Statuses>) : {}))
    .catch(() => ({}));
  return pending;
}

type Props = {
  url: string;
  /** `pill` for the keynote slides, `badge` for the rows of More work. */
  variant: "pill" | "badge";
  /** What the badge says until (or unless) the check comes back. */
  fallback?: string | null;
  className?: string;
};

/** A dot that says whether the project's site answers right now. */
export function LiveStatus({ url, variant, fallback, className }: Props) {
  const { t, lang } = useI18n();
  const dateLocale = lang === "ru" ? ru : undefined;
  const [status, setStatus] = useState<ProbeStatus | null>(null);

  useEffect(() => {
    let alive = true;
    loadStatuses().then((all) => alive && setStatus(all[url] ?? null));
    return () => {
      alive = false;
    };
  }, [url]);

  if (!status) {
    return variant === "badge" && fallback ? <span className={cn(badge, className)}>{fallback}</span> : null;
  }

  const label = status.up ? t.status.up : t.status.down;
  const detail = fmt(status.up ? t.status.upSince : t.status.downSince, {
    when: format(status.since, "d MMM, HH:mm", { locale: dateLocale }),
    ago: formatDistanceToNowStrict(status.checked, { addSuffix: true, locale: dateLocale }),
  });
  const dot = (
    <i
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", status.up ? "animate-live bg-live" : "bg-[#ff453a]")}
    />
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            variant === "pill"
              ? "inline-flex items-center gap-2 rounded-pill bg-stage-tile px-3 py-1.5 text-sm text-stage-chip"
              : cn(badge, "inline-flex items-center gap-1.5"),
            className,
          )}
        >
          {dot}
          {label}
          {status.up && variant === "pill" && (
            <span className="text-stage-dim tabular-nums">{fmt(t.status.ms, { ms: status.ms })}</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

const badge =
  "relative z-10 ml-2 border-2 border-current px-1.75 py-px font-mono text-[11px] whitespace-nowrap uppercase";
