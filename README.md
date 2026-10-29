<div align="center">

# 👋 kewldan.ru

**Daniel's personal site: from the kernel up to the UI.**

[![Deploy](https://github.com/kewldan/kewldan.ru/actions/workflows/deploy.yml/badge.svg)](https://github.com/kewldan/kewldan.ru/actions/workflows/deploy.yml)
[![Site](https://img.shields.io/website?url=https%3A%2F%2Fkewldan.ru&label=kewldan.ru&up_message=online&down_message=offline)](https://kewldan.ru)

[![Next.js](https://img.shields.io/badge/Next.js_16-000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React_19-20232a?logo=react&logoColor=61dafb)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_4-0f172a?logo=tailwindcss&logoColor=38bdf8)](https://tailwindcss.com)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000?logo=shadcnui&logoColor=white)](https://ui.shadcn.com)
[![Motion](https://img.shields.io/badge/Motion-111?logo=framer&logoColor=fff)](https://motion.dev)
[![Rust](https://img.shields.io/badge/Rust_·_axum-b7410e?logo=rust&logoColor=white)](https://github.com/tokio-rs/axum)
[![Valkey](https://img.shields.io/badge/Valkey_9-6983ff?logo=redis&logoColor=white)](https://valkey.io)
[![Docker](https://img.shields.io/badge/Docker-2496ed?logo=docker&logoColor=white)](https://www.docker.com)
[![Traefik](https://img.shields.io/badge/Traefik-24a1c1?logo=traefikproxy&logoColor=white)](https://traefik.io)

</div>

---

## ✨ What's inside

- 🎨 **Two worlds on one page.** Neo-brutal *paper* (who I am) and a black keynote *stage* (the work), with a design-token system underneath.
- 🟨 **Pixel battle.** One shared 64×32 board, live for everyone on the page: optimistic painting, server-side ink limits, other people's cursors.
- 🎬 **Watched.** Films and series I've rated from 1 to 10, at [`/watched`](https://kewldan.ru/watched), editable from the site with an admin token.
- 🛠️ **Admin panel.** `/admin`, behind passkeys: the Watched list, pixel-board moderation and rules, project order, the hero and page blocks, sessions and a sign-in log. Changes go live without a deploy.
- 🦀 **Rust content API.** Every word of the site lives in one JSON file, checked against typed structs at startup; the TypeScript types are generated from Rust.
- 🌀 **Smooth by default.** Lenis scrolling, Motion springs and scroll-linked scenes, and all of it respects `prefers-reduced-motion`.
- 📱 **Adaptive.** Fluid type and layout from 320 px phones to wide screens.
- 📊 **Live numbers.** GitHub contributions, repos and PRs, Steam games and hours: the API refreshes them every 6 hours.
- 🖼️ **Share cards.** Open Graph images for both pages and both languages, rendered from the same content.

## 🗺️ Layout

```
apps/
  api/   🦀 Rust (axum): /api/content, /api/watched, /api/pixels/ws, admin routes
         content/en.json   ← all site copy lives here
  web/   ⚛️ Next.js 16, React 19, Tailwind 4, shadcn/ui, Motion, Lenis
         src/lib/copy.ts   ← interface strings (buttons, statuses)
deploy/  🚚 nginx config and the server-side deploy script
docker-compose.yml   🐳 production stack behind the server-wide Traefik
```

## 🧠 How it fits together

<details>
<summary><b>📝 Content</b></summary>

`apps/api/content/en.json` is parsed into typed Rust structs at startup
(`apps/api/src/content.rs`), so a broken file fails loudly instead of rendering
`undefined`. `cargo test` exports the same types to
`apps/web/src/lib/api/generated`, and CI fails if they drift. Next.js fetches
`/api/content` with `'use cache'` and a one-minute lifetime; if the API is down
it renders from the copy of the JSON bundled at build time.

Inline markup in text fields: `**bold**`, `_serif accent_`, `==highlighter box==`.

</details>

<details>
<summary><b>🟨 Pixel battle</b></summary>

Clients paint optimistically and send 50 ms batches. The server spends per-IP
ink (40, refilling 5 per second) and rolls back what it rejects. With Valkey a
Lua script writes the cell and publishes the event atomically, so every
instance applies changes in the same order. Without `VALKEY_URL` the board
lives in memory. Protocol: `apps/api/src/pixels/protocol.rs`.

</details>

<details>
<summary><b>🎬 Watched</b></summary>

Titles are kept in a Valkey hash. Anyone can read `/api/watched`; creating,
editing and deleting need `Authorization: Bearer $ADMIN_TOKEN`. On the page,
the footer's **Admin** link takes the token once and keeps it on that device.

</details>

<details>
<summary><b>🛠️ Admin panel</b></summary>

`/admin` signs in with a passkey (the admin token is the fallback, and the
way in before the first passkey). Site settings are one document in Valkey
that the API lays over the content it serves; after a change it calls the
web app's `/revalidate` (`WEB_URL`, authorised by `ADMIN_TOKEN`), so the page
shows it on the next visit. Addresses in sessions and the sign-in log are
kept as the network plus a salted hash.

The pixel board logs who painted each stroke (a salted hash, never the
address). Select an area in the admin to see who drew there, then take one
painter's strokes back and ban them. Bans are hidden: the banned painter
still sees their own strokes, nobody else does. A burst of painting sends
the board to Telegram with buttons to undo the painter or lock the board.

</details>

<details>
<summary><b>📊 Live stats</b></summary>

Content strings hold placeholders like `{gh.contributions}` or `{steam.games}`.
`apps/api/content/stats.json` has the fallback numbers; `apps/api/src/stats.rs`
refreshes them from GitHub (public API, or GraphQL with `GITHUB_TOKEN` for
contributions and private repos) and Steam (`STEAM_API_KEY` + `STEAM_ID`), and
fills them in (`2,195`). Current values: `GET /api/stats`.

</details>

<details>
<summary><b>🎨 Design tokens</b></summary>

`apps/web/src/styles/tokens.css` has three tiers: primitives → semantic roles →
Tailwind theme and shadcn slots. A dark theme is wired up (it only remaps
semantic tokens) but switched off: `THEME_SWITCH` in `apps/web/src/lib/theme.ts`. Motion timing lives in
`apps/web/src/lib/motion.ts` and mirrors the CSS easing tokens.

</details>

## 🚀 Development

```bash
pnpm install
ADMIN_TOKEN=dev cargo run --manifest-path apps/api/Cargo.toml   # :8080, board in memory
pnpm dev                                                        # :3000
```

Want the Valkey path? `docker run --rm -p 6379:6379 valkey/valkey:9-alpine` and
start the API with `VALKEY_URL=redis://localhost:6379`.

✅ The same checks as CI:

```bash
pnpm --filter web format:check && pnpm lint && pnpm typecheck && pnpm build
cd apps/api && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

## 🔌 API

| Route | |
| --- | --- |
| `GET /api/health` | `{"status":"ok","board":"valkey"}` |
| `GET /api/content` | Site content with stats filled in, with `ETag` |
| `GET /api/stats` | The live (or fallback) numbers behind the placeholders |
| `GET /api/watched` | Rated titles, newest first |
| `GET /api/pixels` | Board snapshot |
| `GET /api/pixels/ws` | Pixel battle WebSocket |
| `POST /api/admin/watched` · `PUT` / `DELETE /api/admin/watched/{id}` | Edit the Watched list |
| `POST /api/admin/content/reload` | Re-read `CONTENT_PATH`; rejects an invalid file |
| `POST /api/admin/pixels/clear` · `/reset` | Empty the board / restore the seed |
| `GET` / `PUT /api/admin/settings` | Page blocks, hero, project order, board rules, token sign-in |
| `GET /api/admin/passkeys` · `PATCH` / `DELETE /api/admin/passkeys/{id}` | Passkeys: list, rename, remove |
| `GET` / `DELETE /api/admin/sessions` · `DELETE /api/admin/sessions/{id}` | Sessions; sign out one or all others |
| `GET /api/admin/auth/log` | The last 50 sign-in events |
| `POST /api/admin/pixels/painters` · `/undo` | Who painted in an area; take one painter back and ban them |
| `GET /api/admin/pixels/bans` · `PUT` / `DELETE /api/admin/pixels/bans/{who}` | Hidden bans on the board |

🔐 Admin routes need `Authorization: Bearer $ADMIN_TOKEN` (unless turned off in the admin) or the session cookie a passkey sign-in sets.

## 🚚 Deploy

The server-wide Traefik on the external `virtual-hosts` network terminates TLS
(`myresolver`) and forwards to the `proxy` nginx, which sends `/api/*` to Rust
and everything else to Next.js.

Every push to `main` runs the checks, builds
`ghcr.io/kewldan/kewldan.ru/{web,api}` and runs `deploy/deploy.sh` on the server
over SSH.

<details>
<summary><b>One-time server setup</b></summary>

```bash
git clone https://github.com/kewldan/kewldan.ru.git /root/kewldan.ru
cp /root/kewldan.ru/.env.example /root/kewldan.ru/.env   # set ADMIN_TOKEN
```

GitHub secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_USER`,
`DEPLOY_HOST`. Optional variable `SITE_URL` (defaults to `https://kewldan.ru`).

Optional, for live stats: `GITHUB_TOKEN` (fine-grained, read-only) and
`STEAM_API_KEY` + `STEAM_ID` in the same `.env`.

Edit copy without a release: change `apps/api/content/en.json` on the server, then

```bash
curl -XPOST -H "Authorization: Bearer $ADMIN_TOKEN" https://kewldan.ru/api/admin/content/reload
```

</details>

---

<div align="center">

Made in Pushkin 🏰 · [kewldan.ru](https://kewldan.ru) · [Telegram](https://t.me/kewldan)

</div>
