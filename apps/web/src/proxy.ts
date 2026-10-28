import { type NextRequest, NextResponse } from "next/server";

import { defaultLocale, hasLocale, LOCALE_COOKIE, type Locale } from "@/i18n/config";

/** The saved choice first, then the browser's languages. */
function pickLocale(req: NextRequest): Locale {
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
  if (hasLocale(first)) return;
  const url = req.nextUrl.clone();
  url.pathname = `/${pickLocale(req)}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Not the API, Next internals, emoji or files with an extension.
  matcher: ["/((?!api|_next|emoji|media|.*\\..*).*)"],
};
