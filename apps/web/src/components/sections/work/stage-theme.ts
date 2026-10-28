import type { StageTheme } from "@/lib/api/generated/StageTheme";

/** Colour roles for a slide; light slides swap the stage for paper-white. */
export function stageTheme(theme: StageTheme) {
  const light = theme === "light";
  return {
    light,
    slide: light ? "bg-stage-light text-stage-light-fg" : "bg-stage text-stage-fg",
    dim: light ? "text-stage-light-dim" : "text-stage-dim",
    strong: light ? "text-stage-light-fg" : "text-stage-fg",
    link: light ? "text-stage-light-link" : "text-stage-link",
    chip: light ? "bg-stage-light-tile text-stage-light-fg" : "bg-stage-tile text-stage-chip",
  };
}
