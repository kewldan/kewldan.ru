"use client";

import { cn } from "cn";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import type { WatchStatus } from "@/lib/api/generated/WatchStatus";

export const STATUS: Record<WatchStatus, string> = {
  watched: "Watched",
  watching: "Watching now",
  paused: "On pause",
  dropped: "Dropped",
  want: "Want to watch",
};

export const Chip = ({ st }: { st: WatchStatus }) => <span className={`chip st-${st}`}>{STATUS[st]}</span>;

export function Switch({
  on,
  set,
  label,
  blocking,
  disabled,
}: {
  on: boolean;
  set: (v: boolean) => void;
  label: string;
  blocking?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("swt", blocking && "blocking")}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => set(!on)}
    >
      <span className="track">
        <span className="knob" />
      </span>
    </button>
  );
}

export function Head({
  n,
  title,
  lead,
  children,
}: {
  n: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="head">
      <div>
        <p className="eyebrow">{n}</p>
        <h1 className="h1">{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

/** A panel that slides in from the right, over a scrim that closes it. */
export function Sheet({
  label,
  onClose,
  onSubmit,
  children,
}: {
  label: string;
  onClose: () => void;
  onSubmit?: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const Body = onSubmit ? "form" : "div";
  return (
    <div className="sheet-wrap">
      <button className="sheet-back" aria-label="Close" onClick={onClose} />
      <Body className="sheet" role="dialog" aria-label={label} onSubmit={onSubmit} data-lenis-prevent>
        {children}
      </Body>
    </div>
  );
}

/**
 * "Delete" → "Delete? Click again": the second click within three seconds
 * does it. Returns the armed key and a click handler.
 */
export function useArmed<K extends string>() {
  const [armed, setArmed] = useState<K | null>(null);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  const press = useCallback(
    (key: K, act: () => void) => {
      if (armed === key) {
        setArmed(null);
        act();
      } else setArmed(key);
    },
    [armed],
  );
  return [armed, press] as const;
}

const ToastContext = createContext<(msg: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(""), 2600);
    return () => clearTimeout(id);
  }, [msg]);
  return (
    <ToastContext.Provider value={setMsg}>
      {children}
      {msg && (
        <p className="toast" role="status">
          {msg}
        </p>
      )}
    </ToastContext.Provider>
  );
}

export const Mark = () => (
  <svg viewBox="0 0 28 28" fill="none" aria-hidden>
    <rect x="1" y="1" width="26" height="26" rx="7" stroke="var(--tx)" strokeWidth="1.6" />
    <path
      d="M10 8v12M10 15.5l5.5-5M12.6 13.2 17 20"
      stroke="var(--tx)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const KeyIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="15"
    height="15"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="5.5" cy="10.5" r="3" />
    <path d="M7.6 8.4 14 2M11.5 4.5l1.5 1.5M10 6l1.2 1.2" />
  </svg>
);

export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
    <circle cx="6" cy="6" r="4.5" fill="none" stroke="var(--tx3)" strokeWidth="1.4" />
    <path d="M9.5 9.5L13 13" stroke="var(--tx3)" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/** API error codes → what to tell the admin. */
const ERRORS: Record<string, string> = {
  token: "Signed out: sign in again.",
  title: "Add a title first.",
  rating: "Scores go from 1 to 10 in halves.",
  year: "That year does not look right.",
  too_long: "Something is too long.",
  full: "The list is full.",
  poster: "That poster path is not from TMDB.",
  headline: "The headline is too long: 120 characters at most.",
  marquee: "Up to 20 marquee words, 40 characters each.",
  board: "Ink from 1 to 500, refill from 0.1 to 50 a second.",
  no_passkeys: "Add a passkey first, or you could not sign in.",
  last_passkey: "This is the only way in: add another passkey or turn the token back on.",
  name: "Give it a name.",
  tmdb: "TMDB is not answering.",
};

export const errorText = (err: unknown) => ERRORS[(err as Error)?.message] ?? "Could not save. Try again.";
