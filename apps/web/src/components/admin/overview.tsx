"use client";

import { ago } from "@/lib/admin";

import { useAdmin } from "./context";
import { Head } from "./ui";

export function Overview() {
  const { data, go, reload } = useAdmin();
  const board = data.board;
  const cells = board ? board.width * board.height : 0;
  const painted = board ? [...board.board].filter((c) => c !== ".").length : 0;
  const settings = data.settings;
  const projects = data.content?.work.projects ?? [];
  const hidden = projects.filter((p) => settings?.hiddenProjects.includes(p.id)).length;
  const probes = Object.values(data.status ?? {});

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
          <p className="lbl">Projects</p>
          <p className="stat">{data.content ? projects.length - hidden : "—"}</p>
          <p className="lbl">
            on the slides
            {hidden > 0 && (
              <>
                , <span className="mono">{hidden}</span> hidden
              </>
            )}
          </p>
        </div>
        <div className="card pad">
          <p className="lbl">Live sites</p>
          <p className="stat">{data.status ? `${probes.filter((p) => p.up).length}/${probes.length}` : "—"}</p>
          <p className="lbl">answering their probes</p>
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
