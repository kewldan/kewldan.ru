import type { Title } from "@/lib/api/generated/Title";
import type { TitleInput } from "@/lib/api/generated/TitleInput";

/** Score tier → gradient and solid colour tokens. */
export function tier(rating: number) {
  const t = rating >= 9 ? "top" : rating >= 7 ? "good" : rating >= 5 ? "mid" : "low";
  return { gradient: `var(--score-${t})`, solid: `var(--score-${t}-solid)` };
}

export const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}.${m}.${y}` : "—";
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

const call = <T>(token: Credential, method: string, path: string, body?: TitleInput) =>
  request<T>(`/api/admin${path}`, method, token, body);

export const adminApi = {
  check: (token: Credential) => call<void>(token, "GET", "/check"),
  create: (token: Credential, t: TitleInput) => call<Title>(token, "POST", "/watched", t),
  update: (token: Credential, id: string, t: TitleInput) => call<Title>(token, "PUT", `/watched/${id}`, t),
  remove: (token: Credential, id: string) => call<void>(token, "DELETE", `/watched/${id}`),
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
