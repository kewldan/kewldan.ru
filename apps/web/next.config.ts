import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The share images read these TTFs at request time.
  outputFileTracingIncludes: {
    "/*/opengraph-image": ["./src/og/fonts/**"],
    "/*/watched/opengraph-image": ["./src/og/fonts/**"],
    "/*/work/*/opengraph-image": ["./src/og/fonts/**"],
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
  // English lives at the root; /en was its address for a while.
  async redirects() {
    return [{ source: "/en", destination: "/", permanent: true }];
  },
  async rewrites() {
    return [
      // In production nginx sends /api to Rust before Next sees it; in
      // development this proxy does the same job.
      { source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:8080"}/api/:path*` },
      // The pages live under app/[lang]; English is served without the
      // prefix, Russian with it (/ru/...).
      { source: "/", destination: "/en" },
      { source: "/work/:path*", destination: "/en/work/:path*" },
      { source: "/watched", destination: "/en/watched" },
      { source: "/watched/:path*", destination: "/en/watched/:path*" },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Watched posters; the server fetches and caches them, visitors never hit TMDB.
    remotePatterns: [new URL("https://image.tmdb.org/t/p/**")],
  },
};

export default nextConfig;
