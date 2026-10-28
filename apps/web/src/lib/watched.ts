import type { Title } from "@/lib/api/generated/Title";
import type { TitleInput } from "@/lib/api/generated/TitleInput";

/** Score tier → gradient and solid colour tokens; no score is grey. */
export function tier(rating: number | null) {
  if (rating === null) return { gradient: "linear-gradient(#5a5a60,#5a5a60)", solid: "#5a5a60" };
  const t = rating >= 9 ? "top" : rating >= 7 ? "good" : rating >= 5 ? "mid" : "low";
  return { gradient: `var(--score-${t})`, solid: `var(--score-${t}-solid)` };
}

/** 7.5 → "7.5", 9 → "9", none → "—". */
export const fmtScore = (rating: number | null) => (rating === null ? "—" : String(rating));

/** "When" as written; an ISO date from older entries reads as 28.10.2026. */
export const fmtWhen = (s: string) => {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : s || "—";
};

/**
 * A sortable number from a free-form "when": "01.10.2026", "2024",
 * "winter 2023/24 – spring 2026" (the latest year counts), "a few years ago"
 * (unknown, sorts last).
 */
export function whenKey(s: string) {
  const dmy = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dmy) return Number(dmy[3]) * 10000 + Number(dmy[2]) * 100 + Number(dmy[1]);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  const years = [...s.matchAll(/(19|20)\d\d/g)].map((m) => Number(m[0]));
  // A year alone counts as its start, so a known exact date in it ranks higher.
  return years.length ? Math.max(...years) * 10000 : 0;
}

/** Today as 29.10.2026, the format new entries use. */
export const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

/** An error code from the API (or a network failure) → the key of a message. */
export function errorKey<T extends Record<string, string>>(err: unknown, messages: T): keyof T {
  const code = (err as Error)?.message;
  return code in messages ? code : "save";
}

const TOKEN_KEY = "kd-admin-token";

export const adminToken = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode: the token lives for this tab only */
    }
  },
};

const HINT_KEY = "kd-admin";

/**
 * "This browser signed in as admin before". Not a secret: it only spares
 * every visitor an `/api/admin/check` that would answer 401.
 */
export const adminHint = {
  get: () => {
    try {
      return localStorage.getItem(HINT_KEY) === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(HINT_KEY, "1");
      else localStorage.removeItem(HINT_KEY);
    } catch {
      /* private mode */
    }
  },
};

/** `null` means "the passkey session cookie", which the browser sends itself. */
export type Credential = string | null;

async function request<T>(url: string, method: string, token: Credential, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Errors carry a code (`rating`, `full`, `passkey`...) that the page translates.
  if (res.status === 401 && url.startsWith("/api/admin")) throw new Error("token");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? "save");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const call = <T>(token: Credential, method: string, path: string, body?: unknown) =>
  request<T>(`/api/admin${path}`, method, token, body);

export const adminApi = {
  check: (token: Credential) => call<void>(token, "GET", "/check"),
  create: (token: Credential, t: TitleInput) => call<Title>(token, "POST", "/watched", t),
  update: (token: Credential, id: string, t: TitleInput) => call<Title>(token, "PUT", `/watched/${id}`, t),
  remove: (token: Credential, id: string) => call<void>(token, "DELETE", `/watched/${id}`),
};

/** Moderation for the pixel board. */
export const pixelAdmin = {
  rewind: (token: Credential, at: number) => call<void>(token, "POST", "/pixels/rewind", { at }),
  erase: (token: Credential, area: { x: number; y: number; w: number; h: number }) =>
    call<void>(token, "POST", "/pixels/erase", area),
  clear: (token: Credential) => call<void>(token, "POST", "/pixels/clear"),
  reset: (token: Credential) => call<void>(token, "POST", "/pixels/reset"),
};

type Ceremony<O> = { id: string; options: { publicKey: O } };
export type PasskeyInfo = { id: string; name: string; createdAt: number };

/** Passkey sign-in and management; the browser part is @simplewebauthn/browser. */
export const passkeys = {
  available: async () => (await request<{ available: boolean }>("/api/auth/passkey", "GET", null)).available,

  /** Asks the device for a passkey, then trades it for a session cookie. */
  signIn: async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const { id, options } = await request<Ceremony<Parameters<typeof startAuthentication>[0]["optionsJSON"]>>(
      "/api/auth/passkey/login/start",
      "POST",
      null,
    );
    const credential = await startAuthentication({ optionsJSON: options.publicKey });
    await request<void>("/api/auth/passkey/login/finish", "POST", null, { id, credential });
  },

  /** Creates a passkey on this device for the signed-in admin. */
  register: async (token: Credential, name: string) => {
    const { startRegistration } = await import("@simplewebauthn/browser");
    const { id, options } = await request<Ceremony<Parameters<typeof startRegistration>[0]["optionsJSON"]>>(
      "/api/admin/passkeys/register/start",
      "POST",
      token,
    );
    const credential = await startRegistration({ optionsJSON: options.publicKey });
    return request<PasskeyInfo>("/api/admin/passkeys/register/finish", "POST", token, { id, credential, name });
  },

  signOut: () => request<void>("/api/auth/logout", "POST", null),
};

/** A short label for a new passkey: "Mac", "iPhone", "Windows"... */
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "This device";
}
