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

/** Daniel as a schema.org Person, linked to every profile in the contact section. */
export function person({ profile, contact }: Pick<Content, "profile" | "contact">) {
  return {
    "@type": "Person",
    "@id": `${profile.siteUrl}/#person`,
    name: profile.name,
    alternateName: [profile.shortName, profile.handle],
    url: profile.siteUrl,
    jobTitle: profile.role,
    description: profile.description,
    affiliation: { "@type": "CollegeOrUniversity", name: "ITMO University", url: "https://itmo.ru" },
    sameAs: contact.socials.map((s) => s.href),
  };
}
