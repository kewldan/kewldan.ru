import { Fragment } from "react";

import { cn } from "@/lib/utils";

/**
 * Inline markup used by the content API:
 *   **bold**   _serif italic accent_   ==highlighter box==   `code`
 */
export type RichToken = { kind: "text"; text: string } | { kind: "bold" | "italic" | "mark" | "code"; text: string };

const PATTERN = /\*\*(.+?)\*\*|==(.+?)==|`([^`]+)`|(?<!\w)_(.+?)_(?!\w)/g;

export function parseRich(source: string): RichToken[] {
  const out: RichToken[] = [];
  let last = 0;
  for (const m of source.matchAll(PATTERN)) {
    if (m.index > last) out.push({ kind: "text", text: source.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "mark", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "code", text: m[3] });
    else out.push({ kind: "italic", text: m[4] });
    last = m.index + m[0].length;
  }
  if (last < source.length) out.push({ kind: "text", text: source.slice(last) });
  return out;
}

/** The text without its markup, for meta descriptions and labels. */
export const plainRich = (source: string) =>
  parseRich(source)
    .map((t) => t.text)
    .join("");

export const richClass = {
  bold: "font-semibold",
  italic: "font-serif font-normal italic tracking-[-0.01em] text-cobalt",
  code: "rounded-md bg-black/8 px-[0.3em] py-[0.05em] font-mono text-[0.86em] font-normal tracking-normal",
  mark: "inline-block -rotate-[1.6deg] border-4 border-ink bg-yellow text-on-accent px-[0.08em] pb-[0.02em] leading-[0.92] shadow-[8px_8px_0_var(--ink)]",
} as const;

type RichProps = {
  text: string;
  /** Per-token class overrides, e.g. a stage-coloured bold. */
  classes?: Partial<Record<"bold" | "italic" | "mark" | "code", string>>;
};

export function Rich({ text, classes }: RichProps) {
  return parseRich(text).map((t, i) => {
    if (t.kind === "text") return <Fragment key={i}>{t.text}</Fragment>;
    const Tag = t.kind === "bold" ? "b" : t.kind === "code" ? "code" : "span";
    return (
      <Tag key={i} className={cn(richClass[t.kind], classes?.[t.kind])}>
        {t.text}
      </Tag>
    );
  });
}
