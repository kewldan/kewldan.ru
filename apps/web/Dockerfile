# syntax=docker/dockerfile:1.7
# Build context: the repository root (the app bundles apps/api/content as a
# fallback and installs from the workspace lockfile).

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.15.0
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter web... --store-dir /pnpm-store

FROM base AS build
WORKDIR /repo
COPY --from=deps /repo ./
COPY apps/web apps/web
COPY apps/api/content apps/api/content
# Unreachable during the build on purpose: pages prerender from the bundled
# content and refresh from the live API at runtime.
ARG API_URL=http://api:8080
ENV API_URL=${API_URL}
RUN pnpm --filter web build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
