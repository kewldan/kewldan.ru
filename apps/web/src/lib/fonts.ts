import {
  Geist,
  Instrument_Sans,
  Instrument_Serif,
  JetBrains_Mono,
  Playfair_Display,
  Roboto_Flex,
} from "next/font/google";

const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"], axes: ["wdth"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});
const geist = Geist({ variable: "--font-geist", subsets: ["latin", "cyrillic"] });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "700"],
});

// Instrument has no Cyrillic. These cover only the Cyrillic range and come
// first in the stacks (tokens.css), so Latin still renders in Instrument and
// an English page downloads them only for the odd Russian word. Roboto Flex
// has the width axis the condensed headlines use. No metric fallback: it is
// a local Arial that would swallow the Latin too.
const cyrillicSans = Roboto_Flex({
  variable: "--font-cyrillic-sans",
  subsets: ["cyrillic"],
  axes: ["wdth"],
  preload: false,
  adjustFontFallback: false,
});
const cyrillicSerif = Playfair_Display({
  variable: "--font-cyrillic-serif",
  subsets: ["cyrillic"],
  style: "italic",
  preload: false,
  adjustFontFallback: false,
});

/** Every font variable, for `<html className>`. */
export const fontVariables = [instrumentSans, instrumentSerif, geist, jetbrainsMono, cyrillicSans, cyrillicSerif]
  .map((f) => f.variable)
  .join(" ");
