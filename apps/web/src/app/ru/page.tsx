import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd, profilePage } from "@/components/json-ld";
import { StageHeader } from "@/components/site/stage-header";
import { getContent } from "@/lib/api/content";

export async function generateMetadata(): Promise<Metadata> {
  const { profile, ru } = await getContent();
  const title = `${ru.name} (${profile.handle}): ${ru.role}`;
  return {
    title: { absolute: title },
    description: ru.description,
    alternates: { canonical: "/ru" },
    openGraph: { title, description: ru.description, url: "/ru", locale: "ru_RU", alternateLocale: "en_US" },
  };
}

/**
 * Who I am, in Russian, on one page: the name the way it is spelled in
 * Russian, a few paragraphs and the projects, each linked to its case
 * study. The rest of the site stays in English.
 */
export default async function RussianPage() {
  const c = await getContent();
  const { profile, ru, work, contact } = c;
  const projects = work.projects.filter((p) => !p.hidden && ru.projects[p.id]);

  return (
    <div data-surface="stage" lang="ru" className="min-h-dvh bg-stage font-stage tracking-[-0.015em] text-stage-fg">
      <JsonLd data={profilePage(c, { path: "/ru", name: `${ru.name}: ${ru.role}`, lang: "ru" })} />
      <StageHeader handle={profile.handle} />
      <main className="wrap flex max-w-200 flex-col gap-[clamp(48px,7vw,88px)] py-[clamp(56px,9vw,120px)]">
        <header className="flex flex-col gap-4">
          <p className="text-eyebrow font-semibold text-stage-dim">
            {profile.handle} · {ru.role}
          </p>
          <h1 className="gradient-text pb-[0.06em] text-[clamp(52px,10vw,128px)] leading-[0.95] font-bold tracking-[-0.06em] [--g:var(--title-gradient)]">
            {ru.name}
          </h1>
          <p lang="en" className="text-xl text-stage-dim">
            {profile.name}
          </p>
        </header>

        <section className="flex flex-col gap-5 text-[clamp(18px,2vw,22px)] leading-[1.5]">
          {ru.about.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>

        <section aria-labelledby="ru-work" className="flex flex-col gap-8">
          <h2 id="ru-work" className="text-[clamp(32px,4.4vw,52px)] font-semibold tracking-[-0.04em]">
            {ru.workTitle}
          </h2>
          <ul className="flex flex-col divide-y divide-stage-rule border-y border-stage-rule">
            {projects.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-6">
                <h3 className="text-2xl font-bold tracking-[-0.03em]">
                  <Link
                    href={p.case ? `/work/${p.id}` : (p.links[0]?.href ?? "/")}
                    className="gradient-text hover:underline"
                    style={{ "--g": p.gradient } as React.CSSProperties}
                  >
                    {p.name}
                  </Link>
                </h3>
                <p className="leading-[1.55] text-stage-dim">{ru.projects[p.id]}</p>
                {p.links.length > 0 && (
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {p.links.map((l) => (
                      <a key={l.href} href={l.href} className="text-stage-chip hover:text-stage-fg">
                        {l.label.replace(/\s*[›↗→]$/, "")} ↗
                      </a>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="leading-[1.55] text-stage-dim">
            {ru.more}{" "}
            <Link href="/#more" hrefLang="en" className="text-stage-chip hover:text-stage-fg">
              More work&nbsp;→
            </Link>
          </p>
        </section>

        <section aria-labelledby="ru-contact" className="flex flex-col gap-5">
          <h2 id="ru-contact" className="text-[clamp(32px,4.4vw,52px)] font-semibold tracking-[-0.04em]">
            {ru.contactTitle}
          </h2>
          <p className="text-lg">{ru.contact}</p>
          <ul className="flex flex-wrap gap-2.5">
            {contact.socials.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  rel="me"
                  className="inline-block rounded-full border border-stage-rule px-4 py-2 text-sm transition-colors hover:border-stage-fg"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <Link href="/" hrefLang="en" className="self-start text-lg font-semibold text-stage-chip hover:text-stage-fg">
          {ru.english}&nbsp;→
        </Link>
      </main>
    </div>
  );
}
