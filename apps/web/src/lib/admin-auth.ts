/** The admin's session: the token or passkey, and the calls that use it. */
import type { Painter } from "@/lib/api/generated/Painter";
import type { PixelBan } from "@/lib/api/generated/PixelBan";

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
  // Errors carry a code (`passkey`, `headline`...) that the page translates.
  if (res.status === 401 && url.startsWith("/api/admin")) throw new Error("token");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? "save");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** An admin endpoint under `/api/admin`, with the token or the session cookie. */
export const call = <T>(token: Credential, method: string, path: string, body?: unknown) =>
  request<T>(`/api/admin${path}`, method, token, body);

export const adminApi = {
  check: (token: Credential) => call<void>(token, "GET", "/check"),
};

/** Moderation for the pixel board. */
export const pixelAdmin = {
  rewind: (token: Credential, at: number) => call<void>(token, "POST", "/pixels/rewind", { at }),
  erase: (token: Credential, area: { x: number; y: number; w: number; h: number }) =>
    call<void>(token, "POST", "/pixels/erase", area),
  clear: (token: Credential) => call<void>(token, "POST", "/pixels/clear"),
  reset: (token: Credential) => call<void>(token, "POST", "/pixels/reset"),
  /** Who painted in the area over the last day, most cells first. */
  painters: async (token: Credential, area: { x: number; y: number; w: number; h: number }) =>
    (await call<{ items: Painter[] }>(token, "POST", "/pixels/painters", area)).items,
  /** Takes back one painter's strokes since `since` and bans them. */
  undo: (token: Credential, who: string, since: number) =>
    call<{ cells: number }>(token, "POST", "/pixels/undo", { who, since }),
  bans: async (token: Credential) => (await call<{ items: PixelBan[] }>(token, "GET", "/pixels/bans")).items,
  ban: (token: Credential, who: string) => call<void>(token, "PUT", `/pixels/bans/${who}`),
  unban: (token: Credential, who: string) => call<void>(token, "DELETE", `/pixels/bans/${who}`),
  /** A sample alert to the bot's chat. */
  testAlert: (token: Credential) => call<void>(token, "POST", "/pixels/alert"),
};

type Ceremony<O> = { id: string; options: { publicKey: O } };
export type PasskeyInfo = {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number | null;
  /** Backed up by a password manager rather than bound to one device. */
  synced: boolean;
};

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
