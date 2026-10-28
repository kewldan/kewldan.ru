import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Weight = 400 | 500 | 600 | 700;
type Font = { name: string; data: Buffer; weight: Weight; style: "normal" | "italic" };

const dir = join(process.cwd(), "src/og/fonts");
const load = async (file: string, name: string, weight: Weight, style: Font["style"] = "normal"): Promise<Font> => ({
  name,
  data: await readFile(join(dir, file)),
  weight,
  style,
});

/**
 * Static TTFs for the share images (Satori cannot read WOFF2 or pick a
 * variable-font instance).
 */
export async function ogFonts(): Promise<Font[]> {
  return Promise.all([
    load("InstrumentSans-Condensed-SemiBold.ttf", "InstrumentDisplay", 600),
    load("InstrumentSans-Medium.ttf", "InstrumentSans", 500),
    load("InstrumentSans-SemiBold.ttf", "InstrumentSans", 600),
    load("InstrumentSerif-Italic.ttf", "InstrumentSerif", 400, "italic"),
    load("JetBrainsMono-Regular.ttf", "Mono", 400),
    load("JetBrainsMono-Bold.ttf", "Mono", 700),
    load("Geist-Medium.ttf", "Geist", 500),
    load("Geist-Bold.ttf", "Geist", 700),
  ]);
}

export const ogSize = { width: 1200, height: 630 };

/** Font families as Satori knows them. */
export const ogFamily = {
  display: "InstrumentDisplay",
  paper: "InstrumentSans",
  serif: "InstrumentSerif",
  mono: "Mono",
  stage: "Geist",
};
