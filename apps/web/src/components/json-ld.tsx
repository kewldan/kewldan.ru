import type { Content } from "@/lib/api/generated/Content";

/** Structured data for search engines; `<` is escaped so the JSON cannot close the tag. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

type Who = Pick<Content, "profile" | "contact" | "hero" | "stack">;

const ref = (siteUrl: string, name: string) => `${siteUrl}/#${name}`;

/**
 * Daniel as a schema.org Person, linked to every profile in the contact
 * section. Every spelling of the name is here, Russian included, so a
 * search for any of them lands on the same person.
 */
export function person({ profile, contact, hero, stack }: Who) {
  const [given, ...rest] = profile.name.split(" ");
  const family = rest.join(" ");
  return {
    "@type": "Person",
    "@id": ref(profile.siteUrl, "person"),
    name: profile.name,
    givenName: given,
    familyName: family,
    alternateName: [...profile.alternateNames, profile.handle],
    url: profile.siteUrl,
    image: hero.photo && new URL(hero.photo.src, profile.siteUrl).toString(),
    jobTitle: profile.role,
    description: profile.description,
    knowsAbout: stack.groups.flatMap((g) => g.items.map((i) => i.replace(/\s*\(.*\)$/, ""))),
    knowsLanguage: ["ru", "en"],
    homeLocation: { "@type": "Place", name: "Pushkin, Saint Petersburg, Russia" },
    affiliation: { "@type": "CollegeOrUniversity", name: "ITMO University", url: "https://itmo.ru" },
    sameAs: contact.socials.map((s) => s.href),
  };
}

/** The site itself, published by that person. */
export function website({ profile }: Who) {
  return {
    "@type": "WebSite",
    "@id": ref(profile.siteUrl, "website"),
    url: profile.siteUrl,
    name: `${profile.name} (${profile.handle})`,
    alternateName: [profile.handle, ...profile.alternateNames, new URL(profile.siteUrl).host],
    inLanguage: ["en", "ru"],
    publisher: { "@id": ref(profile.siteUrl, "person") },
  };
}

/** A page about the person: the home page, in either language. */
export function profilePage(c: Who, { path, name, lang }: { path: string; name: string; lang: string }) {
  const url = new URL(path, c.profile.siteUrl).toString();
  return {
    "@context": "https://schema.org",
    "@graph": [
      website(c),
      {
        "@type": "ProfilePage",
        "@id": `${url}#page`,
        url,
        name,
        inLanguage: lang,
        isPartOf: { "@id": ref(c.profile.siteUrl, "website") },
        mainEntity: person(c),
      },
    ],
  };
}
