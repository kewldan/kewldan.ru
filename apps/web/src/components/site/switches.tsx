"use client";

import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/components/lang";
import { readTheme, resolvedTheme, setTheme, subscribeTheme, type Theme, THEME_SWITCH } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** "paper" for the neo-brutal header, "stage" for the dark keynote pages. */
export type Tone = "paper" | "stage";

export const trigger: Record<Tone, string> = {
  paper:
    "brutal bg-surface px-2.5 min-h-10 shadow-brutal-sm transition-[translate,box-shadow] duration-(--dur-fast) hover:-translate-y-0.5 hover:shadow-[4px_6px_0_var(--ink)] data-[state=open]:translate-x-0.5 data-[state=open]:translate-y-0.5 data-[state=open]:shadow-none",
  stage:
    "rounded-pill bg-stage-tile px-3 min-h-9 text-stage-fg transition-colors hover:bg-stage-frame data-[state=open]:bg-stage-frame",
};

const menu: Record<Tone, string> = {
  paper: "brutal rounded-none bg-surface p-1 text-ink shadow-brutal ring-0",
  stage:
    "rounded-2xl border border-stage-frame bg-stage-tile p-1.5 text-stage-fg shadow-[0_20px_60px_rgb(0_0_0/0.35)] ring-0",
};

const item: Record<Tone, string> = {
  paper: "rounded-none font-paper text-[15px] focus:bg-yellow focus:text-on-accent",
  stage: "rounded-xl font-stage text-[15px] focus:bg-stage-frame focus:text-stage-fg",
};

/** False during SSR and hydration, true afterwards. */
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/** The theme switch, while THEME_SWITCH is on. */
export function Switches({ tone = "paper" }: { tone?: Tone }) {
  return <>{THEME_SWITCH && <ThemeSwitch tone={tone} />}</>;
}

export function ThemeSwitch({ tone = "paper" }: { tone?: Tone }) {
  const t = useT();
  const theme = useSyncExternalStore<Theme>(subscribeTheme, readTheme, () => "system");
  const resolved = useSyncExternalStore(subscribeTheme, resolvedTheme, () => undefined);
  // The theme is only known in the browser; render a neutral icon until then.
  const mounted = useMounted();

  const options = [
    { id: "light", label: t.theme.light, Icon: SunIcon },
    { id: "dark", label: t.theme.dark, Icon: MoonIcon },
    { id: "system", label: t.theme.system, Icon: MonitorIcon },
  ] as const;
  const shown = mounted ? resolved : undefined;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={t.theme.label}
        className={cn(
          "relative inline-flex w-10 items-center justify-center overflow-hidden outline-none",
          trigger[tone],
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={shown ?? "unknown"}
            initial={{ y: 18, rotate: -90, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -18, rotate: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="flex"
          >
            {shown === "dark" ? <MoonIcon className="size-4.5" /> : <SunIcon className="size-4.5" />}
          </motion.span>
        </AnimatePresence>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className={cn("w-auto min-w-44", menu[tone])}>
        {options.map(({ id, label, Icon }) => (
          <DropdownMenuItem key={id} onSelect={() => setTheme(id)} className={cn("gap-3 px-3 py-2.5", item[tone])}>
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {mounted && theme === id && <CheckIcon className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
