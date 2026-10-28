import { Reveal, RevealGroup, RevealItem } from "@/components/motion/reveal";
import { Rich } from "@/components/rich";
import { SectionLabel } from "@/components/section-label";
import type { About as AboutContent } from "@/lib/api/generated/About";
import { cn } from "@/lib/utils";

const STAMPS = ["-rotate-3 bg-yellow", "rotate-2 bg-white", "-rotate-1 bg-pink", "rotate-3 bg-white"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <RevealItem className="grid grid-cols-1 gap-4 border-b border-rule py-4.5 text-md leading-normal md:grid-cols-[1fr_2.4fr]">
      <span className="pt-0.75 text-sm text-ink-muted">{label}</span>
      <div>{children}</div>
    </RevealItem>
  );
}

export function About({ about }: { about: AboutContent }) {
  return (
    <section id="about" className="wrap grid-index border-t-[1.5px] border-ink py-section">
      <SectionLabel label={about.label} />
      <div className="col-span-12 flex min-w-0 flex-col gap-7 md:col-span-9 md:col-start-4">
        <Reveal>
          <p className="max-w-[24ch] text-pull font-medium text-pretty">{about.pull}</p>
        </Reveal>
        <RevealGroup className="flex flex-col border-t-[1.5px] border-ink">
          <Row label="Right now">
            <ul className="flex flex-col gap-0.5">
              {about.now.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Row>
          <Row label="Character">
            <ul className="mb-2.5 flex flex-wrap gap-2.5">
              {about.traits.map((t, i) => (
                <li
                  key={t}
                  className={cn(
                    "px-2.75 py-1.25 font-mono text-sm font-bold uppercase transition-transform duration-(--dur-fast) brutal hover:scale-110 hover:rotate-0",
                    STAMPS[i % STAMPS.length],
                  )}
                >
                  {t}
                </li>
              ))}
            </ul>
            <p className="text-ink-muted">{about.traitsNote}</p>
          </Row>
          <Row label="Love & hate">
            <div className="grid grid-cols-1 gap-4.5 md:grid-cols-2">
              <LoveHate title="love +" items={about.love} className="bg-green" />
              <LoveHate title="hate −" items={about.hate} note={about.hateNote} className="bg-pink" />
            </div>
          </Row>
          <Row label="Hobbies">
            <p>{about.hobbies}</p>
          </Row>
          <Row label="Desk">
            <p>
              <Rich text={about.desk} />
            </p>
          </Row>
        </RevealGroup>
      </div>
    </section>
  );
}

function LoveHate({
  title,
  items,
  note,
  className,
}: {
  title: string;
  items: string[];
  note?: string;
  className: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-4 py-3.5 shadow-[5px_5px_0_var(--ink)] transition-[translate,box-shadow] duration-(--dur-fast) brutal hover:-translate-y-1 hover:shadow-[5px_9px_0_var(--ink)]",
        className,
      )}
    >
      <h4 className="text-[30px] leading-none font-bold tracking-[-0.04em]">{title}</h4>
      <ul>
        {items.map((x) => (
          <li key={x} className="font-semibold">
            {x}
          </li>
        ))}
        {note && <li className="font-serif text-lg italic">{note}</li>}
      </ul>
    </div>
  );
}
