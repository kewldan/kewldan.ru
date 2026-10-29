"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { live, panel } from "@/lib/admin";
import type { SiteSettings } from "@/lib/api/generated/SiteSettings";
import { adminApi, adminHint, adminToken, type Credential, passkeys } from "@/lib/watched";

import { AdminContext, type Admin, type Data, type Section } from "./context";
import { Overview } from "./overview";
import { Pixels } from "./pixels";
import { Projects } from "./projects";
import { Security } from "./security";
import { SignIn } from "./sign-in";
import { Site } from "./site";
import { Mark, ToastProvider, useToast } from "./ui";
import { Watched } from "./watched";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "watched", label: "Watched" },
  { id: "pixels", label: "Pixel board" },
  { id: "projects", label: "Projects" },
  { id: "site", label: "Site" },
  { id: "security", label: "Security" },
];

const onHash = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};
function useSection(): Section {
  const hash = useSyncExternalStore(
    onHash,
    () => location.hash.slice(1),
    () => "",
  );
  return SECTIONS.some((s) => s.id === hash) ? (hash as Section) : "overview";
}

type Theme = "auto" | "dark" | "light";
const THEME_KEY = "kd-admin-theme";
const themeListeners = new Set<() => void>();
const readTheme = (): Theme => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "dark" || t === "light" ? t : "auto";
  } catch {
    return "auto";
  }
};
function useTheme() {
  const theme = useSyncExternalStore(
    (f) => {
      themeListeners.add(f);
      return () => void themeListeners.delete(f);
    },
    readTheme,
    () => "auto" as Theme,
  );
  const set = (t: Theme) => {
    try {
      if (t === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch {
      /* private mode: the choice lasts until reload */
    }
    themeListeners.forEach((f) => f());
  };
  return [theme, set] as const;
}

const EMPTY: Data = { titles: null, board: null, settings: null, content: null, status: null, health: null };

/**
 * `/admin`: everything on the site that changes without a deploy. Signs in
 * with a passkey (or the admin token), then loads what each section shows.
 */
export function AdminApp() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="kd-admin" data-theme={theme === "auto" ? undefined : theme}>
      <ToastProvider>
        <Gate theme={theme} setTheme={setTheme} />
      </ToastProvider>
    </div>
  );
}

function Gate({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  // undefined: still checking whether this browser is signed in.
  const [cred, setCred] = useState<Credential | undefined>(undefined);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const token = adminToken.get();
    adminApi.check(token).then(
      () => setCred(token),
      () => setOut(true),
    );
  }, []);

  const signIn = (c: Credential) => {
    adminToken.set(c);
    adminHint.set(true);
    setCred(c);
    setOut(false);
  };
  const signOut = useCallback(async () => {
    await passkeys.signOut().catch(() => {});
    adminToken.set(null);
    adminHint.set(false);
    setCred(undefined);
    setOut(true);
  }, []);

  if (out) return <SignIn onSignIn={signIn} />;
  if (cred === undefined) return <div className="gate" aria-busy="true" />;
  return <Panel cred={cred} signOut={signOut} theme={theme} setTheme={setTheme} />;
}

function Panel({
  cred,
  signOut,
  theme,
  setTheme,
}: {
  cred: Credential;
  signOut: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
}) {
  const section = useSection();
  const toast = useToast();
  const [data, setData] = useState<Data>(EMPTY);
  const [wantsNew, setWantsNew] = useState(false);

  const reload = useCallback(
    (what: keyof Data) => {
      const load = {
        titles: live.titles,
        board: live.board,
        settings: () => panel.settings(cred),
        content: live.content,
        status: live.status,
        health: live.health,
      }[what];
      return load().then(
        (value) => setData((d) => ({ ...d, [what]: value })),
        (err: unknown) => {
          if ((err as Error).message !== "token") return;
          toast("Signed out: sign in again.");
          signOut();
        },
      );
    },
    [cred, toast, signOut],
  );

  useEffect(() => {
    for (const k of Object.keys(EMPTY) as (keyof Data)[]) void reload(k);
  }, [reload]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section]);

  const admin = useMemo<Admin>(
    () => ({
      cred,
      data,
      reload,
      setTitles: (f) => setData((d) => ({ ...d, titles: f(d.titles ?? []) })),
      saveSettings: async (next: SiteSettings) => {
        const saved = await panel.saveSettings(cred, next);
        setData((d) => ({ ...d, settings: saved }));
        void reload("content");
      },
      go: (s, then) => {
        location.hash = s;
        if (then === "new") setWantsNew(true);
      },
      wantsNew,
      clearWantsNew: () => setWantsNew(false),
      expired: (err) => {
        if ((err as Error)?.message !== "token") return false;
        toast("Signed out: sign in again.");
        signOut();
        return true;
      },
    }),
    [cred, data, reload, wantsNew, toast, signOut],
  );

  const badge: Partial<Record<Section, number>> = { watched: data.titles?.length };

  return (
    <AdminContext.Provider value={admin}>
      <div className="app">
        <aside className="side">
          <a className="brand" href="#overview">
            <Mark />
            <b>
              kewldan <span>admin</span>
            </b>
          </a>
          <nav className="nav" aria-label="Sections">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} aria-current={section === s.id ? "page" : undefined}>
                {s.label}
                {badge[s.id] != null && <em>{badge[s.id]}</em>}
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <div className="seg" role="group" aria-label="Theme" style={{ alignSelf: "flex-start" }}>
              {(["auto", "dark", "light"] as const).map((k) => (
                <button key={k} aria-pressed={theme === k} onClick={() => setTheme(k)}>
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <Link href="/">kewldan.ru ↗</Link>
            <Link href="/watched">Watched ↗</Link>
            <button className="txt" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>
        <main className="main">
          <div className="inner">
            {section === "overview" && <Overview />}
            {section === "watched" && <Watched />}
            {section === "pixels" && <Pixels />}
            {section === "projects" && <Projects />}
            {section === "site" && <Site />}
            {section === "security" && <Security />}
          </div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
