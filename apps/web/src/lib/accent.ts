import type { Accent } from "@/lib/api/generated/Accent";

/** Accent token → background utility. Literal strings so Tailwind sees them. */
export const accentBg: Record<Accent, string> = {
  yellow: "bg-yellow",
  pink: "bg-pink",
  blue: "bg-blue",
  green: "bg-green",
  orange: "bg-orange",
  cobalt: "bg-cobalt text-white",
  ink: "bg-ink text-white",
};
