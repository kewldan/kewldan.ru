import path from "node:path";
import type { NextConfig } from "next";

const EMOJI_VERSION = "16.0.0";

const nextConfig: NextConfig = {
  output: "standalone",
  // The share images read these TTFs at request time.
  outputFileTracingIncludes: {
    "/[locale]/opengraph-image": ["./src/og/fonts/**"],
    "/[locale]/watched/opengraph-image": ["./src/og/fonts/**"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    // The monorepo root: lets the app bundle apps/api/content as a fallback.
    root: path.join(__dirname, "../.."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      // In production nginx sends /api to Rust before Next sees it; in
      // development this proxy does the same job.
      { source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:8080"}/api/:path*` },
      // Apple emoji through our own origin: one set of glyphs for everyone,
      // and no third-party CDN for visitors where it is slow or blocked.
      {
        source: "/emoji/:file",
        destination: `https://cdn.jsdelivr.net/npm/emoji-datasource-apple@${EMOJI_VERSION}/img/apple/64/:file`,
      },
    ];
  },
  async headers() {
    return [
      { source: "/emoji/:file", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
