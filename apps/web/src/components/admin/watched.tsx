"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Kind } from "@/lib/api/generated/Kind";
import type { Title } from "@/lib/api/generated/Title";
import type { TitleInput } from "@/lib/api/generated/TitleInput";
import type { TmdbHit } from "@/lib/api/generated/TmdbHit";
import type { WatchStatus } from "@/lib/api/generated/WatchStatus";
import { adminApi, fmtScore, fmtWhen, posterUrl, today, whenKey } from "@/lib/watched";

import { useAdmin } from "./context";
import { Chip, errorText, Head, SearchIcon, Sheet, STATUS, useArmed, useToast } from "./ui";

type Filter = "all" | WatchStatus;
type Sort = "recent" | "best" | "title";

type Draft = {
  id: string | null;
  title: string;
  kind: Kind;
  year: string;
  rating: number | null;
  status: WatchStatus;
  seasons: string;
  watched: string;
  note: string;
  poster: string | null;
};

const blank = (): Draft => ({
  id: null,
  title: "",
  kind: "movie",
  year: "",
  rating: null,
  status: "watched",
  seasons: "",
  watched: today(),
  note: "",
  poster: null,
});

const toDraft = (t: Title): Draft => ({
  id: t.id,
  title: t.title,
  kind: t.kind,
  year: t.year ? String(t.year) : "",
  rating: t.rating,
  status: t.status,
  seasons: t.seasons,
  watched: t.watched,
  note: t.note,
  poster: t.poster ?? null,
});

const toInput = (d: Draft): TitleInput => ({
  title: d.title.trim(),
  kind: d.kind,
  year: Number.parseInt(d.year, 10) || null,
  rating: d.status === "want" ? null : d.rating,
  status: d.status,
  seasons: d.kind === "series" ? d.seasons : "",
  watched: d.status === "want" ? "" : d.watched,
  note: d.note,
  poster: d.poster,
});

const inputOf = (t: Title): TitleInput => ({
  title: t.title,
  kind: t.kind,
  year: t.year,
  rating: t.rating,
  status: t.status,
  seasons: t.seasons,
  note: t.note,
  watched: t.watched,
  poster: t.poster,
});

const SORTS: Record<Sort, (a: Title, b: Title) => number> = {
  recent: (a, b) => whenKey(b.watched) - whenKey(a.watched) || b.createdAt - a.createdAt,
  best: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title),
  title: (a, b) => a.title.localeCompare(b.title),
};

export function Watched() {
  const { cred, data, setTitles, reload, wantsNew, clearWantsNew, expired } = useAdmin();
  const toast = useToast();
  const titles = useMemo(() => data.titles ?? [], [data.titles]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [sel, setSel] = useState<string[]>([]);
  // "Add a title" on the overview lands here with the form open.
  const [edit, setEdit] = useState<Draft | null>(() => (wantsNew ? blank() : null));
  const [armed, press] = useArmed<"bulk">();
  const [busy, setBusy] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wantsNew) clearWantsNew();
  }, [wantsNew, clearWantsNew]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        e.preventDefault();
        qRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: titles.length, watched: 0, watching: 0, paused: 0, dropped: 0, want: 0 };
    for (const t of titles) c[t.status] += 1;
    return c;
  }, [titles]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return titles
      .filter((t) => (filter === "all" || t.status === filter) && (!ql || t.title.toLowerCase().includes(ql)))
      .toSorted(SORTS[sort]);
  }, [titles, filter, q, sort]);

  const allOn = shown.length > 0 && shown.every((t) => sel.includes(t.id));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const bulkStatus = async (st: WatchStatus) => {
    setBusy(true);
    const picked = titles.filter((t) => sel.includes(t.id));
    const results = await Promise.allSettled(
      picked.map((t) =>
        adminApi.update(cred, t.id, {
          ...inputOf(t),
          status: st,
          rating: st === "want" ? null : t.rating,
          watched: st === "want" ? "" : t.watched,
        }),
      ),
    );
    const saved = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    setTitles((l) => l.map((t) => saved.find((s) => s.id === t.id) ?? t));
    const failed = results.length - saved.length;
    toast(failed ? `Moved ${saved.length}, ${failed} failed` : `Moved ${saved.length} to ${STATUS[st]}`);
    setSel([]);
    setBusy(false);
  };

  const bulkDelete = async () => {
    setBusy(true);
    const results = await Promise.allSettled(sel.map((id) => adminApi.remove(cred, id)));
    const gone = sel.filter((_, i) => results[i].status === "fulfilled");
    setTitles((l) => l.filter((t) => !gone.includes(t.id)));
    toast(
      gone.length === sel.length
        ? `Deleted ${gone.length}`
        : `Deleted ${gone.length}, ${sel.length - gone.length} failed`,
    );
    setSel([]);
    setBusy(false);
  };

  const findPosters = async () => {
    setBusy(true);
    try {
      const { filled, missed } = await adminApi.findPosters(cred);
      await reload("titles");
      toast(missed.length ? `Found ${filled} posters · no match for ${missed.join(", ")}` : `Found ${filled} posters`);
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async (file: File) => {
    setBusy(true);
    const rows = parseTitles(await file.text());
    let ok = 0;
    const added: Title[] = [];
    for (const input of rows) {
      try {
        added.push(await adminApi.create(cred, input));
        ok += 1;
      } catch (err) {
        if (expired(err)) break;
      }
    }
    setTitles((l) => [...added, ...l]);
    toast(rows.length ? `Imported ${ok} of ${rows.length}` : "No rows with a title in that file");
    setBusy(false);
  };

  return (
    <section>
      <Head n="02 · Content" title="Watched" lead="One row per film or per show. Seasons as a range, when in words.">
        <Link className="btn ghost" href="/watched">
          Public page ↗
        </Link>
        <button className="btn sec" disabled={busy} onClick={findPosters}>
          Find posters
        </button>
        <button className="btn sec" disabled={busy} onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importCsv(f);
          }}
        />
        <button className="btn pri" onClick={() => setEdit(blank())}>
          Add a title
        </button>
      </Head>

      <div className="tools">
        <div className="seg" role="group" aria-label="Status">
          {(["all", ...Object.keys(STATUS)] as Filter[]).map((k) => (
            <button
              key={k}
              aria-pressed={filter === k}
              onClick={() => {
                setFilter(k);
                setSel([]);
              }}
            >
              {k === "all" ? "All" : STATUS[k]}
              <span>{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <label className="query">
            <SearchIcon />
            <span className="sr">Search</span>
            <input ref={qRef} type="search" placeholder="title" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="kbd" aria-hidden>
              /
            </span>
          </label>
          <label className="sr" htmlFor="ws">
            Sort
          </label>
          <select id="ws" className="sel" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recent">Recent</option>
            <option value="best">Best first</option>
            <option value="title">A to Z</option>
          </select>
        </div>
      </div>

      <div className="card">
        {sel.length > 0 && (
          <div className="bulk">
            <b className="mono">{sel.length} selected</b>
            <span className="lbl">Move to</span>
            {(Object.keys(STATUS) as WatchStatus[]).map((k) => (
              <button key={k} className="txt" disabled={busy} onClick={() => bulkStatus(k)}>
                {STATUS[k]}
              </button>
            ))}
            <button
              className="btn blk-o sm"
              style={{ marginLeft: "auto" }}
              disabled={busy}
              onClick={() => press("bulk", bulkDelete)}
            >
              {armed === "bulk" ? `Delete ${sel.length}? Click again` : "Delete"}
            </button>
          </div>
        )}
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    className="cb"
                    aria-label="Select all"
                    checked={allOn}
                    onChange={() => setSel(allOn ? [] : shown.map((t) => t.id))}
                  />
                </th>
                <th>Score</th>
                <th>Title</th>
                <th>Type</th>
                <th className="r">Year</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={sel.includes(t.id) ? "on" : ""} onClick={() => setEdit(toDraft(t))}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="cb"
                      aria-label={`Select ${t.title}`}
                      checked={sel.includes(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                  </td>
                  <td>
                    {t.rating !== null ? (
                      <div className="score">
                        <span className="n">{fmtScore(t.rating)}</span>
                        <div className="mini" aria-hidden>
                          <i style={{ width: `${t.rating * 10}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="cell t3">—</span>
                    )}
                  </td>
                  <td>
                    <span className="tt">
                      {t.poster ? (
                        <Image className="poster" src={posterUrl(t.poster, "w92")} alt="" width={22} height={33} />
                      ) : (
                        <span className="poster hatch" />
                      )}
                      <span className="ttl" title={t.note || t.title}>
                        {t.title}
                      </span>
                    </span>
                  </td>
                  <td className="cell">
                    {t.kind === "series" ? `series${t.seasons ? ` · s${t.seasons}` : ""}` : "movie"}
                  </td>
                  <td className="cell r">{t.year ?? "—"}</td>
                  <td>
                    <Chip st={t.status} />
                  </td>
                  <td className="cell">{fmtWhen(t.watched)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty" style={{ height: 96 }}>
                    {data.titles ? "No match. Try another word, or clear the status filter." : "Loading…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="lbl" style={{ marginTop: 10 }}>
        Click a row to edit · press / to search · CSV columns: title, kind, year, score, status, seasons, when, note
      </p>

      {edit && <TitleSheet draft={edit} onClose={() => setEdit(null)} />}
    </section>
  );
}

function TitleSheet({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { cred, setTitles, expired } = useAdmin();
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [armed, press] = useArmed<"delete">();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return toast("Add a title first.");
    setBusy(true);
    try {
      const input = toInput(d);
      const saved = d.id ? await adminApi.update(cred, d.id, input) : await adminApi.create(cred, input);
      setTitles((l) => (d.id ? l.map((t) => (t.id === saved.id ? saved : t)) : [saved, ...l]));
      toast(d.id ? "Saved" : "Added");
      onClose();
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!d.id) return;
    setBusy(true);
    try {
      await adminApi.remove(cred, d.id);
      setTitles((l) => l.filter((t) => t.id !== d.id));
      toast("Deleted");
      onClose();
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const want = d.status === "want";
  return (
    <Sheet label={d.id ? "Edit title" : "Add a title"} onClose={onClose} onSubmit={save}>
      <div>
        <p className="eyebrow">{d.id ? "Edit" : "New"}</p>
        <h2>{d.id ? d.title || "Untitled" : "Add a title"}</h2>
      </div>

      <TitleField
        value={d.title}
        onChange={(v) => set("title", v)}
        onPick={(h) =>
          setD((x) => ({
            ...x,
            title: h.title,
            kind: h.kind,
            year: h.year ? String(h.year) : x.year,
            poster: h.poster ?? x.poster,
          }))
        }
      />

      <div className="two">
        <div className="f">
          <span className="lbl" id="e-k">
            Type
          </span>
          <div className="seg inv" role="radiogroup" aria-labelledby="e-k">
            {(["movie", "series"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={d.kind === k} onClick={() => set("kind", k)}>
                {k === "movie" ? "Movie" : "Series"}
              </button>
            ))}
          </div>
        </div>
        <div className="f">
          <label className="lbl" htmlFor="e-y">
            Release year
          </label>
          <input
            id="e-y"
            className="inp mono"
            inputMode="numeric"
            maxLength={4}
            value={d.year}
            onChange={(e) => set("year", e.target.value.replace(/\D/g, ""))}
            placeholder="2026"
          />
        </div>
      </div>

      {d.kind === "series" && (
        <div className="f">
          <label className="lbl" htmlFor="e-s">
            Seasons
          </label>
          <input
            id="e-s"
            className="inp mono"
            maxLength={40}
            value={d.seasons}
            onChange={(e) => set("seasons", e.target.value)}
            placeholder="1–5"
          />
        </div>
      )}

      <div className="f">
        <span className="lbl" id="e-st">
          Status
        </span>
        <div className="stpick" role="radiogroup" aria-labelledby="e-st">
          {(Object.keys(STATUS) as WatchStatus[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={d.status === k} onClick={() => set("status", k)}>
              <Chip st={k} />
            </button>
          ))}
        </div>
      </div>

      <div className="f">
        <span className="lbl" id="e-r">
          Score
          {want
            ? " · after you watch it"
            : d.rating !== null
              ? ` · ${fmtScore(d.rating)}/10`
              : " · click twice for a half"}
        </span>
        <div className="rate" role="radiogroup" aria-labelledby="e-r">
          {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => {
            const r = want ? null : d.rating;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                disabled={want}
                className={r !== null && r >= n ? "on" : r === n - 0.5 ? "half" : ""}
                aria-checked={r === n || r === n - 0.5}
                aria-label={`${n} out of 10`}
                onClick={() => set("rating", d.rating === n && n > 1 ? n - 0.5 : n)}
              >
                {n}
              </button>
            );
          })}
        </div>
        {!want && d.rating !== null && (
          <button type="button" className="txt" style={{ alignSelf: "flex-start" }} onClick={() => set("rating", null)}>
            No score
          </button>
        )}
      </div>

      {!want && (
        <div className="f">
          <label className="lbl" htmlFor="e-w">
            When
          </label>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input
              id="e-w"
              className="inp mono"
              maxLength={60}
              value={d.watched}
              onChange={(e) => set("watched", e.target.value)}
              placeholder="29.10.2026, 2024, winter 2023/24 – spring 2026"
            />
            <button type="button" className="btn sec sm" onClick={() => set("watched", today())}>
              Today
            </button>
          </div>
        </div>
      )}

      <div className="f">
        <label className="lbl" htmlFor="e-n">
          Note
        </label>
        <textarea
          id="e-n"
          className="inp"
          value={d.note}
          maxLength={400}
          onChange={(e) => set("note", e.target.value)}
        />
      </div>

      {d.poster && (
        <div className="row" style={{ gap: 12 }}>
          <Image src={posterUrl(d.poster, "w92")} alt="" width={46} height={69} style={{ borderRadius: 4 }} />
          <button type="button" className="txt" onClick={() => set("poster", null)}>
            Remove poster
          </button>
        </div>
      )}

      <div className="sheet-act">
        <button className="btn pri" type="submit" disabled={busy}>
          {d.id ? "Save title" : "Add title"}
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        {d.id && (
          <button
            className="txt bad"
            type="button"
            style={{ marginLeft: "auto" }}
            disabled={busy}
            onClick={() => press("delete", remove)}
          >
            {armed === "delete" ? "Delete? Click again" : "Delete"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** The title, with TMDB matches to fill the year, type and poster from. */
function TitleField({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (h: TmdbHit) => void;
}) {
  const { cred } = useAdmin();
  const [hits, setHits] = useState<TmdbHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (!typed || q.length < 2) return;
    const id = setTimeout(() => {
      adminApi.tmdb(cred, q).then(
        (h) => {
          setHits(h);
          setActive(0);
          setOpen(h.length > 0);
        },
        () => setHits([]),
      );
    }, 350);
    return () => clearTimeout(id);
  }, [value, typed, cred]);

  const pick = (h: TmdbHit) => {
    onPick(h);
    setOpen(false);
    setTyped(false);
  };

  return (
    <div className="f">
      <label className="lbl" htmlFor="e-t">
        Title
      </label>
      <input
        id="e-t"
        className="inp"
        value={value}
        maxLength={160}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="e-t-list"
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") setActive((a) => Math.min(hits.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter") pick(hits[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {open && (
        <div className="suggest" id="e-t-list" role="listbox">
          {hits.slice(0, 6).map((h, i) => (
            <button
              key={`${h.title}-${h.year}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h)}
            >
              {h.poster ? (
                <Image className="poster" src={posterUrl(h.poster, "w92")} alt="" width={22} height={33} />
              ) : (
                <span className="poster hatch" />
              )}
              <span style={{ minWidth: 0 }}>
                <b style={{ fontWeight: 500, display: "block" }}>{h.title}</b>
                <span className="ident">
                  {h.kind} {h.year ? `· ${h.year}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Titles from a CSV with a header row. Columns by name, any order: title,
 * kind (movie/series), year, score, status, seasons, when, note.
 */
function parseTitles(text: string): TitleInput[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const at = {
    title: col("title", "name"),
    kind: col("kind", "type"),
    year: col("year"),
    rating: col("score", "rating"),
    status: col("status"),
    seasons: col("seasons", "season"),
    watched: col("when", "watched", "date"),
    note: col("note", "notes", "comment"),
  };
  const get = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  const statuses = Object.entries(STATUS) as [WatchStatus, string][];
  return rows
    .map((row) => {
      const rawScore = Number.parseFloat(get(row, at.rating).replace(",", "."));
      const rating = Number.isFinite(rawScore) ? Math.min(10, Math.max(1, Math.round(rawScore * 2) / 2)) : null;
      const s = get(row, at.status).toLowerCase();
      const status =
        statuses.find(([k, l]) => k === s || l.toLowerCase() === s)?.[0] ?? (rating === null ? "want" : "watched");
      const kind: Kind = /series|tv|show|сериал/i.test(get(row, at.kind)) ? "series" : "movie";
      return {
        title: get(row, at.title),
        kind,
        year: Number.parseInt(get(row, at.year), 10) || null,
        rating: status === "want" ? null : rating,
        status,
        seasons: kind === "series" ? get(row, at.seasons) : "",
        watched: status === "want" ? "" : get(row, at.watched),
        note: get(row, at.note),
      };
    })
    .filter((t) => t.title);
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas or semicolons. */
function parseCsv(text: string): string[][] {
  const sep =
    (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}
