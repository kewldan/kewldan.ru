"use client";

import { cn } from "cn";
import { useState } from "react";

import { useAdmin } from "./context";
import { errorText, Head, useToast } from "./ui";

type Item = { id: string; name: string; line: string; on: boolean; case: boolean };

/** The featured projects' order on the main page, and which are shown. */
export function Projects() {
  const { data, saveSettings, expired } = useAdmin();
  const toast = useToast();
  const [edited, setEdited] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = data.settings;

  // The content comes ordered and flagged by the saved settings already.
  const saved: Item[] =
    data.content?.work.projects.map((p) => ({
      id: p.id,
      name: p.name,
      line: [p.title, p.titleDim].filter(Boolean).join(" "),
      on: !p.hidden,
      case: !!p.case,
    })) ?? [];
  const list = edited ?? saved;
  const dirty = edited !== null;

  const move = (i: number, d: number) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setEdited(next);
  };
  const flip = (id: string) => setEdited(list.map((p) => (p.id === id ? { ...p, on: !p.on } : p)));

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      await saveSettings({
        ...settings,
        projectOrder: list.map((p) => p.id),
        hiddenProjects: list.filter((p) => !p.on).map((p) => p.id),
      });
      setEdited(null);
      toast("Order saved · live on the site");
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <Head
        n="04 · Content"
        title="Projects"
        lead="Order and visibility of the featured projects. A hidden one leaves the slides; its case page stays up."
      >
        {dirty && (
          <button className="btn ghost" onClick={() => setEdited(null)}>
            Undo
          </button>
        )}
        <button className="btn pri" disabled={!dirty || busy || !settings} onClick={save}>
          Save order
        </button>
      </Head>
      <div className="card">
        {list.map((p, i) => (
          <div key={p.id} className={cn("proj", !p.on && "hid")}>
            <span className="mono t3" style={{ fontSize: 12 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div style={{ minWidth: 0 }}>
              <b>{p.name}</b>
              <p>
                {p.line}
                {p.case && (
                  <>
                    {" · "}
                    <a href={`/work/${p.id}`} target="_blank" rel="noreferrer">
                      case ↗
                    </a>
                  </>
                )}
              </p>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button className="icon" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                className="icon"
                aria-label={`Move ${p.name} down`}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              className={`mode ${p.on ? "on" : "off"}`}
              style={{ width: 92 }}
              aria-label={`${p.on ? "Hide" : "Show"} ${p.name}`}
              onClick={() => flip(p.id)}
            >
              <span className={cn("sw", !p.on && "hatch")} />
              {p.on ? "SHOWN" : "HIDDEN"}
            </button>
          </div>
        ))}
        {!data.content && <p className="empty">Loading…</p>}
      </div>
      {dirty && (
        <p className="lbl" style={{ marginTop: 10 }}>
          Unsaved: the site still shows the old order.
        </p>
      )}
    </section>
  );
}
