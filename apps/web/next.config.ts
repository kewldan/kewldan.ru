import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
  // In production nginx sends /api to Rust before Next sees it; in
  // development this proxy does the same job.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:8080"}/api/:path*` }];
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
