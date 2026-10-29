"use client";

import Image from "next/image";
import { Fragment, useState } from "react";

import type { SiteSettings } from "@/lib/api/generated/SiteSettings";

import { useAdmin } from "./context";
import { errorText, Head, Switch, useToast } from "./ui";

type Blocks = Pick<SiteSettings, "openToOffers" | "dropout" | "pixels" | "watchedInNav">;
type Draft = Blocks & { headline: string | null; marquee: string[] | null };

const BLOCKS: { key: keyof Blocks; title: string; sub: string }[] = [
  { key: "openToOffers", title: "Open to offers", sub: "The live line in the hero" },
  { key: "dropout", title: "Meme button", sub: "“❤️ — Отчислиться” at the bottom" },
  { key: "pixels", title: "Pixel battle", sub: "The shared board after the hero, and its menu link" },
  { key: "watchedInNav", title: "Watched in the menu", sub: "The link to the films page" },
];

/** `==box==` and `_dim_`, the way the hero renders them. */
function Headline({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(==[^=]+==|_[^_]+_)/)
        .map((part, i) =>
          part.startsWith("==") ? (
            <mark key={i}>{part.slice(2, -2)}</mark>
          ) : part.startsWith("_") && part.endsWith("_") && part.length > 2 ? (
            <i key={i}>{part.slice(1, -1)}</i>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  );
}

/** Switches and copy on the main page; nothing goes live until Publish. */
export function Site() {
  const { data, saveSettings, expired } = useAdmin();
  const toast = useToast();
  const settings = data.settings;
  const content = data.content;
  const [edited, setEdited] = useState<Partial<Draft>>({});
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped on publish so the link previews load afresh.
  const [published, setPublished] = useState(0);

  if (!settings || !content) {
    return (
      <section>
        <Head n="05 · Settings" title="Site" lead="Loading…" />
      </section>
    );
  }

  // What the site shows now; the content already carries any override.
  const base: Draft = {
    openToOffers: settings.openToOffers,
    dropout: settings.dropout,
    pixels: settings.pixels,
    watchedInNav: settings.watchedInNav,
    headline: content.hero.headline,
    marquee: content.marquee,
  };
  const d = { ...base, ...edited };
  const dirty = Object.keys(edited).length > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEdited((e) => ({ ...e, [k]: v }));
  const words = d.marquee ?? [];

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const w = word.trim().toUpperCase();
    if (!w) return;
    set("marquee", [...words, w]);
    setWord("");
  };

  const publish = async () => {
    setBusy(true);
    try {
      await saveSettings({
        ...settings,
        openToOffers: d.openToOffers,
        dropout: d.dropout,
        pixels: d.pixels,
        watchedInNav: d.watchedInNav,
        // Only what was touched becomes an override; the rest keeps
        // following the content file.
        headline: "headline" in edited ? (edited.headline ?? null) : settings.headline,
        marquee: "marquee" in edited ? (edited.marquee ?? null) : settings.marquee,
      });
      setEdited({});
      setPublished((n) => n + 1);
      toast("Published · live on the site");
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <Head
        n="05 · Settings"
        title="Site"
        lead="Switches and copy on the main page. Nothing goes live until you publish."
      >
        <a className="btn ghost" href="/" target="_blank" rel="noreferrer">
          Open site ↗
        </a>
        {dirty && (
          <button className="btn ghost" onClick={() => setEdited({})}>
            Discard
          </button>
        )}
        <button className="btn pri" disabled={!dirty || busy} onClick={publish}>
          Publish
        </button>
      </Head>

      <div className="lsheet">
        <div>
          <p className="eyebrow">01</p>
          <h3>Blocks</h3>
          <p className="side-p">Turn whole blocks of the page on or off. The layout closes the gap.</p>
        </div>
        <div className="card">
          {BLOCKS.map((b) => (
            <div key={b.key} className="setting">
              <div>
                <b>{b.title}</b>
                <span>{b.sub}</span>
              </div>
              <Switch on={d[b.key]} set={(v) => set(b.key, v)} label={b.title} />
            </div>
          ))}
        </div>
      </div>

      <div className="lsheet">
        <div>
          <p className="eyebrow">02</p>
          <h3>Hero</h3>
          <p className="side-p">
            The headline: <span className="mono">==word==</span> gets the yellow box,{" "}
            <span className="mono">_words_</span> go grey. The marquee runs above it.
          </p>
        </div>
        <div className="card pad">
          <div className="f">
            <label className="lbl" htmlFor="h-l">
              Headline
            </label>
            <input
              id="h-l"
              className="inp"
              maxLength={120}
              value={d.headline ?? ""}
              placeholder="From the content file"
              onChange={(e) => set("headline", e.target.value)}
            />
            {d.headline ? (
              <div className="preview" aria-label="Headline preview">
                <Headline text={d.headline} />
              </div>
            ) : (
              <p className="hint">Empty: the headline from the content file.</p>
            )}
            {settings.headline !== null && !("headline" in edited) && (
              <button className="txt" style={{ alignSelf: "flex-start" }} onClick={() => set("headline", null)}>
                Back to the content file’s headline
              </button>
            )}
          </div>
          <div className="f">
            <span className="lbl">Marquee · {words.length} words</span>
            <div className="words">
              {words.map((w, i) => (
                <span key={`${w}-${i}`}>
                  {w}
                  <button
                    aria-label={`Remove ${w}`}
                    onClick={() =>
                      set(
                        "marquee",
                        words.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form className="row" onSubmit={add} style={{ flexWrap: "nowrap" }}>
              <label className="sr" htmlFor="h-w">
                New word
              </label>
              <input
                id="h-w"
                className="inp"
                maxLength={40}
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="Add a word"
              />
              <button className="btn sec" type="submit" disabled={words.length >= 20}>
                Add
              </button>
            </form>
            {settings.marquee !== null && !("marquee" in edited) && (
              <button className="txt" style={{ alignSelf: "flex-start" }} onClick={() => set("marquee", null)}>
                Back to the content file’s words
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="lsheet">
        <div>
          <p className="eyebrow">03</p>
          <h3>Link previews</h3>
          <p className="side-p">What Telegram, X and LinkedIn show when someone pastes the link. 1200×630.</p>
        </div>
        <div className="g2 grid">
          {[
            ["/opengraph-image", "Main page"],
            ["/watched/opengraph-image", "Watched"],
          ].map(([src, label]) => (
            <div key={src} className="f">
              <Image
                className="og"
                src={`${src}?v=${published}`}
                alt={`Link preview: ${label}`}
                width={1200}
                height={630}
                unoptimized
              />
              <span className="lbl">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
