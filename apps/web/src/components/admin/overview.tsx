"use client";

import { ago } from "@/lib/admin";
import { fmtScore } from "@/lib/watched";

import { useAdmin } from "./context";
import { Chip, Head } from "./ui";

export function Overview() {
  const { data, go, reload } = useAdmin();
  const titles = data.titles ?? [];
  const rated = titles.filter((t) => t.rating !== null && t.status !== "want");
  const avg = rated.length ? (rated.reduce((s, t) => s + (t.rating ?? 0), 0) / rated.length).toFixed(1) : "—";
  const hist = Array.from({ length: 10 }, (_, k) => rated.filter((t) => Math.floor(t.rating ?? 0) === k + 1).length);
  const hmax = Math.max(1, ...hist);
  const board = data.board;
  const cells = board ? board.width * board.height : 0;
  const painted = board ? [...board.board].filter((c) => c !== ".").length : 0;
  const settings = data.settings;

  // Probe URL → the project it belongs to.
  const names = new Map<string, string>();
  for (const p of data.content?.work.projects ?? []) if (p.probe) names.set(p.probe, p.name);
  for (const p of data.content?.more.items ?? []) if (p.probe) names.set(p.probe, p.name);

  return (
    <section>
      <Head
        n="01 · kewldan.ru"
        title="Overview"
        lead="Everything on the site you can change, and whether it is healthy."
      />
      <div className="g4 grid">
        <div className="card pad">
          <p className="lbl">Titles</p>
          <p className="stat">{data.titles ? titles.length : "—"}</p>
          <p className="lbl">
            average <span className="mono">{avg}</span>
          </p>
        </div>
        <div className="card pad">
          <p className="lbl">Watching now</p>
          <p className="stat">{titles.filter((t) => t.status === "watching").length}</p>
          <p className="lbl">
            <span className="mono">{titles.filter((t) => t.status === "want").length}</span> on the want list
          </p>
        </div>
        <div className="card pad">
          <p className="lbl">Pixel board</p>
          <p className="stat">{board ? `${Math.round((painted / cells) * 100)}%` : "—"}</p>
          <p className="lbl">
            <span className="mono">
              {painted.toLocaleString("en-US")} / {cells.toLocaleString("en-US")}
            </span>{" "}
            cells{settings?.board.locked && " · locked"}
          </p>
        </div>
        <div className="card pad">
          <p className="lbl">Hero badge</p>
          <p className="stat">{settings ? (settings.openToOffers ? "Open" : "Hidden") : "—"}</p>
          <p className="lbl">{settings?.openToOffers ? "Open to offers is shown" : "Offers line is off"}</p>
        </div>

        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">How I score</h2>
            <button className="btn ghost sm" onClick={() => go("watched")}>
              Open Watched
            </button>
          </div>
          <div className="pad">
            <div className="bars" aria-label={`Scores: ${hist.map((n, k) => `${k + 1}: ${n}`).join(", ")}`}>
              {hist.map((n, k) => (
                <i key={k} className={n ? "" : "z"} style={{ height: `${(n / hmax) * 100}%` }} />
              ))}
            </div>
            <div className="axis" aria-hidden>
              {hist.map((_, k) => (
                <span key={k}>{k + 1}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">Site health</h2>
            <button
              className="btn ghost sm"
              onClick={() => (["health", "status", "board"] as const).forEach((k) => void reload(k))}
            >
              Refresh
            </button>
          </div>
          <Health
            label="API"
            state={data.health ? "ok" : "off"}
            value={data.health ? `up · ${data.health.board}` : "checking…"}
          />
          <Health label="Pixel room" state={board ? "ok" : "off"} value={board ? `${board.peers} online` : "—"} />
          <Health label="Watched" state={data.titles ? "ok" : "off"} value={`${titles.length} titles`} />
          {Object.entries(data.status ?? {}).map(([url, p]) => (
            <Health
              key={url}
              label={names.get(url) ?? new URL(url).host}
              state={p.up ? "ok" : "bad"}
              value={p.up ? `${p.ms} ms` : `down · ${ago(p.since)}`}
            />
          ))}
        </div>

        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">Quick actions</h2>
          </div>
          <div className="li">
            <span>Rate something you just watched</span>
            <button className="btn pri sm" onClick={() => go("watched", "new")}>
              Add a title
            </button>
          </div>
          <div className="li">
            <span>Wipe part of the pixel board</span>
            <button className="btn sec sm" onClick={() => go("pixels")}>
              Moderate
            </button>
          </div>
          <div className="li">
            <span>Change the featured order</span>
            <button className="btn sec sm" onClick={() => go("projects")}>
              Projects
            </button>
          </div>
        </div>

        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">Recently added</h2>
          </div>
          {titles
            .toSorted((a, b) => b.createdAt - a.createdAt)
            .slice(0, 4)
            .map((t) => (
              <div key={t.id} className="li">
                <span className="ttl">{t.title}</span>
                <span className="row" style={{ flexWrap: "nowrap" }}>
                  {t.rating !== null && <span className="mono t2">{fmtScore(t.rating)}/10</span>}
                  <Chip st={t.status} />
                </span>
              </div>
            ))}
          {data.titles && !titles.length && <p className="empty">Nothing yet.</p>}
        </div>
      </div>
    </section>
  );
}

function Health({ label, state, value }: { label: string; state: "ok" | "warn" | "bad" | "off"; value: string }) {
  return (
    <div className="health">
      <span className={`hd ${state === "ok" ? "" : state}`} />
      <span>{label}</span>
      <span className={`v ${state === "bad" ? "bad" : state === "warn" ? "warn" : ""}`}>{value}</span>
    </div>
  );
}
