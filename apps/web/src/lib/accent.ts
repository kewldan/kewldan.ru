import type { Accent } from "@/lib/api/generated/Accent";

/** Accent token → background plus a text colour that stays readable in both themes. */
export const accentBg: Record<Accent, string> = {
  yellow: "bg-yellow text-on-accent",
  pink: "bg-pink text-on-accent",
  blue: "bg-blue text-on-accent",
  green: "bg-green text-on-accent",
  orange: "bg-orange text-on-accent",
  cobalt: "bg-cobalt text-white",
  ink: "bg-night text-white",
};
