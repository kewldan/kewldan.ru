import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

/**
 * `POST /revalidate`: the API calls this (with `ADMIN_TOKEN`) after the admin
 * changes the site, so the next visit renders the new content instead of
 * waiting out the cache.
 */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return new Response(null, { status: 401 });
  }
  revalidateTag("content", { expire: 0 });
  return new Response(null, { status: 204 });
}
