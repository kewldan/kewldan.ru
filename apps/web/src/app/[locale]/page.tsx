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
import { hasLocale } from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionaries";
import { getContent } from "@/lib/api/content";
import { notFound } from "next/navigation";

export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(locale)) notFound();
  const c = await getContent(locale);
  const t = dictionaries[locale];
  return (
    <>
      <SiteHeader handle={c.profile.handle} nav={c.nav} marquee={c.marquee} />
      <main>
        <Hero hero={c.hero} />
        <Pixels section={c.pixels} />
        <About about={c.about} t={t.about} />
        <Work work={c.work} />
        <Numbers numbers={c.numbers} />
        <MoreWork more={c.more} />
        <Stack stack={c.stack} usedIn={t.stack.usedIn} />
        <Timeline timeline={c.timeline} />
        <OffScreen off={c.offScreen} />
        <Contact contact={c.contact} email={c.profile.email} />
        <Dropout dropout={c.dropout} />
      </main>
      <SiteFooter footer={c.footer} />
    </>
  );
}
