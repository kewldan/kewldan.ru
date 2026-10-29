"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ago } from "@/lib/admin";
import type { Painter } from "@/lib/api/generated/Painter";
import type { PixelBan } from "@/lib/api/generated/PixelBan";
import { pixelAdmin } from "@/lib/watched";

import { useAdmin } from "./context";
import { errorText, Head, Switch, useArmed, useToast } from "./ui";

type Area = [number, number, number, number];

/**
 * The live board, an eraser for areas, who painted where (to undo and ban
 * them), the hidden bans, and the rules people paint by.
 */
export function Pixels() {
  const { cred, data, reload, saveSettings, expired } = useAdmin();
  const toast = useToast();
  const board = data.board;
  const settings = data.settings;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<[number, number] | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [armed, press] = useArmed<"clear" | "reset">();
  const [busy, setBusy] = useState(false);
  // Slider values not yet saved; null follows the saved rules.
  const [ink, setInk] = useState<number | null>(null);
  const [regen, setRegen] = useState<number | null>(null);
  // Who painted in the selected area; null until a selection is made.
  const [painters, setPainters] = useState<Painter[] | null>(null);
  const [bans, setBans] = useState<PixelBan[] | null>(null);

  useEffect(() => {
    pixelAdmin.bans(cred).then(setBans, () => setBans([]));
  }, [cred]);

  // A live look: the board changes while you moderate it.
  useEffect(() => {
    const id = setInterval(() => void reload("board"), 3000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !board) return;
    for (let i = 0; i < board.width * board.height; i++) {
      const c = board.board.charCodeAt(i);
      ctx.fillStyle = c === 46 ? "#ffffff" : (board.palette[c - 48] ?? "#ffffff");
      ctx.fillRect(i % board.width, Math.floor(i / board.width), 1, 1);
    }
  }, [board]);

  const w = board?.width ?? 64;
  const h = board?.height ?? 32;
  const cell = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(w - 1, Math.floor(((e.clientX - r.left) / r.width) * w))),
      Math.max(0, Math.min(h - 1, Math.floor(((e.clientY - r.top) / r.height) * h))),
    ];
  };
  const norm = area && [
    Math.min(area[0], area[2]),
    Math.min(area[1], area[3]),
    Math.max(area[0], area[2]),
    Math.max(area[1], area[3]),
  ];
  const size = norm ? (norm[2] - norm[0] + 1) * (norm[3] - norm[1] + 1) : 0;
  const painted = board ? [...board.board].filter((c) => c !== ".").length : 0;

  const run = async (act: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await act();
      await reload("board");
      if (done) toast(done);
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const erase = () =>
    norm &&
    run(async () => {
      await pixelAdmin.erase(cred, { x: norm[0], y: norm[1], w: norm[2] - norm[0] + 1, h: norm[3] - norm[1] + 1 });
      setArea(null);
      setPainters(null);
    }, `Cleared ${size} cells`);

  const findPainters = (n: number[]) =>
    pixelAdmin.painters(cred, { x: n[0], y: n[1], w: n[2] - n[0] + 1, h: n[3] - n[1] + 1 }).then(setPainters, (err) => {
      if (!expired(err)) toast(errorText(err));
    });

  const undo = (p: Painter) =>
    run(async () => {
      const { cells } = await pixelAdmin.undo(cred, p.who, p.first);
      setPainters((l) => l?.map((x) => (x.who === p.who ? { ...x, banned: true } : x)) ?? null);
      setBans(await pixelAdmin.bans(cred));
      toast(`Took back ${cells} cells · ${p.who} banned`);
    }, "");

  const rules = settings?.board;
  const inkNow = ink ?? rules?.inkMax ?? 20;
  const regenNow = regen ?? rules?.inkRegen ?? 1;
  const dirty = rules && (inkNow !== rules.inkMax || regenNow !== rules.inkRegen);

  const saveRules = async (next: Partial<NonNullable<typeof rules>>, done: string) => {
    if (!settings) return;
    setBusy(true);
    try {
      await saveSettings({ ...settings, board: { ...settings.board, ...next } });
      setInk(null);
      setRegen(null);
      toast(done);
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <Head
        n="03 · Moderation"
        title="Pixel board"
        lead={`The shared ${w}×${h} board on the main page. Wipe an area, lock it, or change how fast people paint.`}
      >
        <Link className="btn ghost" href="/#pixels">
          Timelapse ↗
        </Link>
        <button
          className="btn sec"
          disabled={busy}
          onClick={() => press("reset", () => run(() => pixelAdmin.reset(cred), "Back to the starting drawing"))}
        >
          {armed === "reset" ? "Replace the board? Click again" : "Starting drawing"}
        </button>
        <button
          className="btn blk-o"
          disabled={busy}
          onClick={() => press("clear", () => run(() => pixelAdmin.clear(cred), "Board cleared for everyone"))}
        >
          {armed === "clear" ? `Clear all ${(w * h).toLocaleString("en-US")}? Click again` : "Clear for everyone"}
        </button>
      </Head>

      <div className="g3 grid">
        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">Board</h2>
            <span className="lbl">
              <span className="mono">
                {painted.toLocaleString("en-US")} / {(w * h).toLocaleString("en-US")}
              </span>{" "}
              painted · {board?.peers ?? 0} online · drag to select
            </span>
          </div>
          <div className="board">
            <canvas
              ref={canvas}
              width={w}
              height={h}
              role="img"
              aria-label="The pixel board. Drag to select an area to clear."
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const c = cell(e);
                drag.current = c;
                setArea([c[0], c[1], c[0], c[1]]);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                const c = cell(e);
                setArea([drag.current[0], drag.current[1], c[0], c[1]]);
              }}
              onPointerUp={() => {
                drag.current = null;
                if (norm) void findPainters(norm);
              }}
            />
            {norm && (
              <span
                className="selbox"
                style={{
                  left: `${(norm[0] / w) * 100}%`,
                  top: `${(norm[1] / h) * 100}%`,
                  width: `${((norm[2] - norm[0] + 1) / w) * 100}%`,
                  height: `${((norm[3] - norm[1] + 1) / h) * 100}%`,
                }}
              />
            )}
            {rules?.locked && (
              <span className="mode on lock">
                <span className="sw" />
                LOCKED
              </span>
            )}
          </div>
          <div className="row" style={{ padding: "0 16px 16px" }}>
            <button className="btn blk-o sm" disabled={!norm || busy} onClick={erase}>
              {norm ? `Clear ${size} cells` : "Clear selection"}
            </button>
            <button
              className="btn ghost sm"
              disabled={!norm}
              onClick={() => {
                setArea(null);
                setPainters(null);
              }}
            >
              Cancel
            </button>
            {norm && (
              <span className="mono t3" style={{ fontSize: 12 }}>
                x {norm[0]}–{norm[2]} · y {norm[1]}–{norm[3]}
              </span>
            )}
          </div>
          {painters && (
            <div style={{ borderTop: "1px solid var(--ln)" }}>
              <div className="li">
                <b style={{ fontWeight: 500 }}>Who painted here · last 24 h</b>
                <span className="lbl">{painters.length || "nobody"}</span>
              </div>
              {painters.map((p) => (
                <div key={p.who} className="li">
                  <div style={{ minWidth: 0 }}>
                    <span className="mono">{p.who}</span>
                    <p className="ident">
                      {p.cells} cells here · last {ago(p.last)}
                    </p>
                  </div>
                  {p.banned ? (
                    <span className="tag">BANNED</span>
                  ) : (
                    <button className="btn blk-o sm" disabled={busy} onClick={() => undo(p)}>
                      Undo and ban
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-h">
            <h2 className="h2">Rules</h2>
          </div>
          <div className="setting">
            <div>
              <b>Lock the board</b>
              <span>Visible, but nobody can paint</span>
            </div>
            <Switch
              on={rules?.locked ?? false}
              set={(v) => saveRules({ locked: v }, v ? "Board locked" : "Board open again")}
              label="Lock the board"
              blocking
              disabled={!rules || busy}
            />
          </div>
          <div className="range">
            <div>
              <label className="lbl" htmlFor="px-ink">
                Ink per person
              </label>
              <b>{inkNow}</b>
            </div>
            <input
              id="px-ink"
              type="range"
              min={10}
              max={200}
              step={10}
              value={inkNow}
              disabled={!rules}
              onChange={(e) => setInk(Number(e.target.value))}
            />
          </div>
          <div className="range">
            <div>
              <label className="lbl" htmlFor="px-regen">
                Refill per second
              </label>
              <b>{regenNow}</b>
            </div>
            <input
              id="px-regen"
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={regenNow}
              disabled={!rules}
              onChange={(e) => setRegen(Number(e.target.value))}
            />
          </div>
          {dirty && (
            <div className="row" style={{ padding: "12px 16px", borderBottom: "1px solid var(--ln)" }}>
              <button
                className="btn pri sm"
                disabled={busy}
                onClick={() => saveRules({ inkMax: inkNow, inkRegen: regenNow }, "Rules saved")}
              >
                Save rules
              </button>
              <button
                className="btn ghost sm"
                onClick={() => {
                  setInk(null);
                  setRegen(null);
                }}
              >
                Reset
              </button>
            </div>
          )}
          <div className="setting">
            <div>
              <b>Telegram alerts</b>
              <span>100+ cells from one painter in 3 minutes: the board, with undo and lock buttons</span>
            </div>
            <button
              className="btn sec sm"
              disabled={busy}
              onClick={() =>
                pixelAdmin.testAlert(cred).then(
                  () => toast("Sent: check Telegram"),
                  (err: unknown) => !expired(err) && toast(errorText(err)),
                )
              }
            >
              Test
            </button>
          </div>
          <div className="pad">
            <span className="lbl">Palette · {board?.palette.length ?? 0} colours</span>
            <div className="palette">
              {board?.palette.map((c) => (
                <span key={c} style={{ background: c }} title={c} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-h">
          <h2 className="h2">Hidden bans</h2>
          <span className="lbl">They still see their own strokes; nobody else does</span>
        </div>
        {bans?.map((b) => (
          <div key={b.who} className="li">
            <div>
              <span className="mono">{b.who}</span>
              <p className="ident">banned {ago(b.at)}</p>
            </div>
            <button
              className="txt"
              onClick={() =>
                pixelAdmin.unban(cred, b.who).then(
                  () => {
                    setBans((l) => l?.filter((x) => x.who !== b.who) ?? null);
                    toast(`Unbanned ${b.who}`);
                  },
                  (err: unknown) => !expired(err) && toast(errorText(err)),
                )
              }
            >
              Unban
            </button>
          </div>
        ))}
        {bans && !bans.length && <p className="empty">Nobody is banned.</p>}
      </div>
    </section>
  );
}
