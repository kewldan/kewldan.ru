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
  if (res.status === 401) throw new Error("The admin token is no longer valid.");
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? "Could not save. Try again in a moment.");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const adminApi = {
  check: (token: string) => call<void>(token, "GET", "/check"),
  create: (token: string, t: TitleInput) => call<Title>(token, "POST", "/watched", t),
  update: (token: string, id: string, t: TitleInput) => call<Title>(token, "PUT", `/watched/${id}`, t),
  remove: (token: string, id: string) => call<void>(token, "DELETE", `/watched/${id}`),
};
