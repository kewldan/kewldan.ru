import type { Locale } from "./config";
import { en } from "./dictionaries/en";
import { ru } from "./dictionaries/ru";

export const dictionaries = { en, ru } satisfies Record<Locale, typeof en>;
