import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "kewldan",
    short_name: "kewldan",
    start_url: "/",
    display: "standalone",
    theme_color: "#fafaf7",
    background_color: "#fafaf7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
