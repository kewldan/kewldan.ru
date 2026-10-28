/**
 * Light / dark / system theme without a library. The inline script in the
 * root layout sets `data-theme` on <html> before the first paint; the hook
 * below keeps React and the attribute in sync afterwards.
 */
export type Theme = "light" | "dark" | "system";

const KEY = "theme";
const DARK = "(prefers-color-scheme: dark)";

/** Runs in <head> before the page paints, so the wrong theme never flashes. */
export const themeScript = `(()=>{try{var t=localStorage.getItem("${KEY}")||"system",d=t==="dark"||(t==="system"&&matchMedia("${DARK}").matches),r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia(DARK).matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
}

const listeners = new Set<() => void>();

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts for this page */
  }
  const swap = () => applyTheme(theme);
  // A soft cross-fade where the browser can do it and motion is welcome.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(swap);
  else swap();
  listeners.forEach((l) => l());
}

export function subscribeTheme(onChange: () => void) {
  listeners.add(onChange);
  const media = matchMedia(DARK);
  const onMedia = () => {
    if (readTheme() === "system") applyTheme("system");
    onChange();
  };
  // Another tab changed the theme.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    applyTheme(readTheme());
    onChange();
  };
  media.addEventListener("change", onMedia);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}

export const resolvedTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
