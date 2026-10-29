import type { Content } from "@/lib/api/generated/Content";
import type { ProbeStatus } from "@/lib/api/generated/ProbeStatus";
import type { SiteSettings } from "@/lib/api/generated/SiteSettings";
import type { Title } from "@/lib/api/generated/Title";
import { call, type Credential, type PasskeyInfo } from "@/lib/watched";

export type Session = {
  id: string;
  createdAt: number;
  seenAt: number;
  agent: string;
  /** Masked: `203.0.113.0/24 · h:7f3a9c0e`. */
  ip: string;
  current: boolean;
};

export type LogEntry = { at: number; ok: boolean; what: string; ip: string | null };

export type Board = { width: number; height: number; palette: string[]; board: string; peers: number };

const read = async <T>(path: string): Promise<T> => {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

/** What anyone can read, fetched fresh for the admin. */
export const live = {
  content: () => read<Content>("/api/content"),
  titles: async () => (await read<{ items: Title[] }>("/api/watched")).items,
  board: () => read<Board>("/api/pixels"),
  status: () => read<Record<string, ProbeStatus>>("/api/status"),
  health: () => read<{ status: string; board: string }>("/api/health"),
};

/** The admin's own endpoints, beyond Watched and the pixel moderation. */
export const panel = {
  settings: (c: Credential) => call<SiteSettings>(c, "GET", "/settings"),
  saveSettings: (c: Credential, s: SiteSettings) => call<SiteSettings>(c, "PUT", "/settings", s),
  passkeys: async (c: Credential) => (await call<{ items: PasskeyInfo[] }>(c, "GET", "/passkeys")).items,
  renamePasskey: (c: Credential, id: string, name: string) =>
    call<PasskeyInfo>(c, "PATCH", `/passkeys/${id}`, { name }),
  removePasskey: (c: Credential, id: string) => call<void>(c, "DELETE", `/passkeys/${id}`),
  sessions: async (c: Credential) => (await call<{ items: Session[] }>(c, "GET", "/sessions")).items,
  endSession: (c: Credential, id: string) => call<void>(c, "DELETE", `/sessions/${id}`),
  endOthers: (c: Credential) => call<{ ended: number }>(c, "DELETE", "/sessions"),
  log: async (c: Credential) => (await call<{ items: LogEntry[] }>(c, "GET", "/auth/log")).items,
};

/** "Mac · Safari" from a user agent; good enough to tell sessions apart. */
export function device(agent: string) {
  const os = /iPhone/.test(agent)
    ? "iPhone"
    : /iPad/.test(agent)
      ? "iPad"
      : /Android/.test(agent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(agent)
          ? "Mac"
          : /Windows/.test(agent)
            ? "Windows"
            : /Linux/.test(agent)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /YaBrowser\//.test(agent)
        ? "Yandex"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : null;
  return [os, browser].filter(Boolean).join(" · ") || "Unknown device";
}

/** 29.10.2026 */
export const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

/** 29.10.2026 14:12 */
export const fmtTime = (ms: number) => {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** "now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 90) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
