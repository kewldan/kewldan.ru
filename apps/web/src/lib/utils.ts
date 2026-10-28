import { createCn } from "cn/config";

/**
 * Class merging that knows the fluid type scale from tokens.css, so
 * `cn("text-keynote", "text-stage-dim")` keeps both: one is a size, the
 * other a colour.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "keynote",
            "mega",
            "huge",
            "final",
            "pull",
            "pull-sm",
            "spec",
            "trio",
            "lead",
            "sub",
            "eyebrow",
            "chip-xl",
            "box",
            "more",
            "filter",
            "md",
          ],
        },
      ],
    },
  },
});
