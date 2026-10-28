import { type NextRequest, NextResponse } from "next/server";

import { defaultLocale, hasLocale, LANGUAGE_SWITCH, LOCALE_COOKIE, type Locale, publicLocales } from "@/i18n/config";

/** The saved choice first, then the browser's languages. */
function pickLocale(req: NextRequest): Locale {
  if (!LANGUAGE_SWITCH) return defaultLocale;
  const saved = req.cookies.get(LOCALE_COOKIE)?.value;
  if (saved && hasLocale(saved)) return saved;
  const accepted = (req.headers.get("accept-language") ?? "")
    .split(",")
    .map((part) => part.split(";")[0].trim().slice(0, 2).toLowerCase());
  return accepted.find(hasLocale) ?? defaultLocale;
}

/** `/watched` → `/ru/watched` (or `/en/...`); paths that carry a locale pass. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split("/")[1] ?? "";
  if (hasLocale(first) && publicLocales.includes(first)) return;
  const url = req.nextUrl.clone();
  // A hidden locale (/ru while the switch is off) keeps its path in English.
  const rest = hasLocale(first) ? pathname.slice(first.length + 1) : pathname;
  url.pathname = `/${pickLocale(req)}${rest === "/" ? "" : rest}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Not the API, Next internals, emoji or files with an extension.
  matcher: ["/((?!api|_next|emoji|media|.*\\..*).*)"],
};
