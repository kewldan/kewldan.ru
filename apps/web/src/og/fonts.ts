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
 * variable-font instance). Onest and Cormorant fill in Cyrillic glyphs that
 * the Instrument families lack.
 */
export async function ogFonts(): Promise<Font[]> {
  return Promise.all([
    load("InstrumentSans-Condensed-SemiBold.ttf", "InstrumentDisplay", 600),
    load("InstrumentSans-Medium.ttf", "InstrumentSans", 500),
    load("InstrumentSans-SemiBold.ttf", "InstrumentSans", 600),
    load("Onest-Medium.ttf", "Onest", 500),
    load("Onest-SemiBold.ttf", "Onest", 600),
    load("InstrumentSerif-Italic.ttf", "InstrumentSerif", 400, "italic"),
    load("CormorantGaramond-MediumItalic.ttf", "Cormorant", 500, "italic"),
    load("JetBrainsMono-Regular.ttf", "Mono", 400),
    load("JetBrainsMono-Bold.ttf", "Mono", 700),
    load("Geist-Medium.ttf", "Geist", 500),
    load("Geist-Bold.ttf", "Geist", 700),
  ]);
}

export const ogSize = { width: 1200, height: 630 };

/** Family stacks: Latin from Instrument, Cyrillic from Onest / Cormorant. */
export const ogFamily = {
  display: "InstrumentDisplay, Onest",
  paper: "InstrumentSans, Onest",
  serif: "InstrumentSerif, Cormorant",
  mono: "Mono",
  stage: "Geist",
};
