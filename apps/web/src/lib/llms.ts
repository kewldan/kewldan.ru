import "server-only";

import { plainRich } from "@/components/rich";
import type { Content } from "@/lib/api/generated/Content";

/**
 * The site as Markdown for language models (llmstxt.org): who I am, every
 * spelling of the name, the projects with links. `full` adds each case
 * study in full, for `/llms-full.txt`.
 */
export function llms(c: Content, full: boolean) {
  const { profile, about, work, more, stack, contact } = c;
  const url = (path: string) => new URL(path, profile.siteUrl).toString();
  const projects = work.projects.filter((p) => !p.hidden);
  const lines: string[] = [
    `# ${profile.name} (${profile.handle})`,
    "",
    `> ${profile.description}`,
    "",
    `Also written ${profile.alternateNames.join(", ")}; the handle is ${profile.handle} everywhere online. ` +
      `The surname is spelled Tenishev (Тенишев), not Tenishchev.`,
    "",
    "## About",
    "",
    plainRich(about.pull),
    "",
    ...about.now.map((n) => `- ${n}`),
    "",
    "## Selected work",
    "",
    ...projects.map((p) => {
      const page = p.case ? url(`/work/${p.id}`) : p.links[0]?.href;
      const links = p.links.map((l) => `[${l.label.replace(/\s*[›↗→]$/, "")}](${l.href})`).join(", ");
      return `- [${p.name}](${page}): ${p.title} ${p.titleDim} ${plainRich(p.lead)}${links ? ` Links: ${links}.` : ""}`;
    }),
    "",
    "## More work",
    "",
    plainRich(more.pull),
    "",
    ...more.items.map(
      (i) =>
        `- ${i.href ? `[${i.name}](${i.href})` : i.name}${i.year ? ` (${i.year})` : ""}: ${plainRich(i.what)} ${plainRich(i.detail)} Stack: ${i.stack}.`,
    ),
    "",
    "## Stack",
    "",
    ...stack.groups.map((g) => `- ${g.name}: ${g.items.join(", ")}`),
    "",
    "## Contact",
    "",
    ...contact.socials.map((s) => `- [${s.label}](${s.href})`),
    "",
    "## Pages",
    "",
    `- [Home](${url("/")}): the whole site, in English`,
    `- [Главная по-русски](${url("/ru")}): the whole site, in Russian`,
    `- [Watched](${url("/watched")}): films and series I have rated`,
    full ? "" : `- [Everything in full](${url("/llms-full.txt")}): this file with every case study`,
  ];

  if (full) {
    for (const p of projects.filter((p) => p.case)) {
      const k = p.case!;
      lines.push("", `## ${p.name}: case study`, "", url(`/work/${p.id}`), "", plainRich(k.summary), "");
      lines.push(...k.facts.map((f) => `- ${f.label}: ${f.value}`), "");
      if (k.pipeline.length) lines.push(`Pipeline: ${k.pipeline.join(" → ")}`, "");
      for (const s of k.sections) {
        lines.push(
          `### ${s.title}`,
          "",
          ...s.body.map((b) => `${plainRich(b)}\n`),
          ...s.bullets.map((b) => `- ${plainRich(b)}`),
        );
        if (s.bullets.length) lines.push("");
      }
    }
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

export const markdown = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
