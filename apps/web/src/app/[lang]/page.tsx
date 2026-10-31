import type { Metadata } from "next";

import { JsonLd, profilePage } from "@/components/json-ld";
import { About } from "@/components/sections/about";
import { Contact } from "@/components/sections/contact";
import { Dropout } from "@/components/sections/dropout";
import { Hero } from "@/components/sections/hero";
import { MoreWork } from "@/components/sections/more-work/more-work";
import { Numbers } from "@/components/sections/numbers";
import { OffScreen } from "@/components/sections/off-screen";
import { Pixels } from "@/components/sections/pixels";
import { Stack } from "@/components/sections/stack";
import { Timeline } from "@/components/sections/timeline";
import { Work } from "@/components/sections/work/work";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { getContent } from "@/lib/api/content";
import { getCalendar } from "@/lib/api/live";
import { copy } from "@/lib/copy";
import { alternates, langOf, localize } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  return { alternates: alternates(langOf(await params), "/") };
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const lang = langOf(await params);
  const t = copy[lang];
  const [c, calendar] = await Promise.all([getContent(lang), getCalendar()]);
  // Blocks and projects the admin switched off.
  const shown = (block: string) => !c.hidden?.includes(block);
  return (
    <>
      <JsonLd
        data={profilePage(c, {
          path: localize(lang, "/"),
          name: `${c.profile.name} (${c.profile.handle}): ${c.profile.role}`,
          lang,
        })}
      />
      <SiteHeader
        handle={c.profile.handle}
        nav={c.nav.map((l) => ({ ...l, href: localize(lang, l.href) }))}
        marquee={c.marquee}
      />
      <main>
        <Hero hero={c.hero} />
        {shown("pixels") && <Pixels section={c.pixels} />}
        <About about={c.about} t={t.about} />
        <Work work={{ ...c.work, projects: c.work.projects.filter((p) => !p.hidden) }} lang={lang} />
        <Numbers numbers={c.numbers} calendar={calendar} />
        <MoreWork more={c.more} />
        <Stack stack={c.stack} usedIn={t.stack.usedIn} />
        <Timeline timeline={c.timeline} />
        <OffScreen off={c.offScreen} />
        <Contact contact={c.contact} email={c.profile.email} />
        {shown("dropout") && <Dropout dropout={c.dropout} />}
      </main>
      <SiteFooter footer={c.footer} lang={lang} />
    </>
  );
}
