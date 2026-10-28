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

async function call<T>(token: string, method: string, path: string, body?: TitleInput): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  // Errors carry a code (`rating`, `full`, ...) that the page translates.
  if (res.status === 401) throw new Error("token");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? "save");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const adminApi = {
  check: (token: string) => call<void>(token, "GET", "/check"),
  create: (token: string, t: TitleInput) => call<Title>(token, "POST", "/watched", t),
  update: (token: string, id: string, t: TitleInput) => call<Title>(token, "PUT", `/watched/${id}`, t),
  remove: (token: string, id: string) => call<void>(token, "DELETE", `/watched/${id}`),
};
