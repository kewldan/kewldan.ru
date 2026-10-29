"use client";

import { useCallback, useEffect, useState } from "react";

import { ago, device, fmtDate, fmtTime, type LogEntry, panel, type Session } from "@/lib/admin";
import { deviceName, type PasskeyInfo, passkeys as webauthn } from "@/lib/watched";

import { useAdmin } from "./context";
import { errorText, Head, KeyIcon, Sheet, Switch, useArmed, useToast } from "./ui";

/** The browser's "user closed the prompt" error. */
const cancelled = (err: unknown) => err instanceof Error && err.name === "NotAllowedError";

type Adding = { step: "name" | "waiting" | "done"; name: string; error?: string };

export function Security() {
  const { cred, data, saveSettings, expired } = useAdmin();
  const toast = useToast();
  const [keys, setKeys] = useState<PasskeyInfo[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [armed, press] = useArmed<string>();
  const settings = data.settings;

  const load = useCallback(
    () =>
      Promise.all([panel.passkeys(cred), panel.sessions(cred), panel.log(cred)]).then(
        ([k, s, l]) => {
          setKeys(k);
          setSessions(s);
          setLog(l);
        },
        (err: unknown) => {
          if (!expired(err)) toast(errorText(err));
        },
      ),
    [cred, expired, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done);
      await load();
    } catch (err) {
      if (!expired(err)) toast(errorText(err));
    }
  };

  const rename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    if (name.trim()) void act(() => panel.renamePasskey(cred, id, name.trim()), "Renamed");
  };

  const register = async () => {
    if (!adding) return;
    const name = adding.name.trim() || deviceName();
    setAdding({ step: "waiting", name });
    try {
      await webauthn.register(cred, name);
      setAdding({ step: "done", name });
      await load();
    } catch (err) {
      if (expired(err)) return;
      setAdding({
        step: "name",
        name,
        error: cancelled(err) ? "Cancelled on the device." : "The device did not make a passkey. Try again.",
      });
    }
  };

  const tokenOff = settings ? !settings.tokenSignIn : false;
  const backup = (keys?.length ?? 0) >= 2;

  return (
    <section>
      <Head n="06 · Access" title="Security" lead="Sign in with passkeys. Keep at least two, on different devices.">
        <button className="btn pri" onClick={() => setAdding({ step: "name", name: deviceName() })}>
          Add a passkey
        </button>
      </Head>

      <div className="g3 grid">
        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">Passkeys</h2>
            <span className="mono t3">{keys?.length ?? "—"}</span>
          </div>
          {keys?.map((k) => (
            <div key={k.id} className="key">
              <span className="key-ic">
                <KeyIcon />
              </span>
              <div className="key-tt">
                {renaming?.id === k.id ? (
                  <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={rename}>
                    <label className="sr" htmlFor={`rn-${k.id}`}>
                      New name
                    </label>
                    <input
                      id={`rn-${k.id}`}
                      className="inp"
                      style={{ height: 32 }}
                      value={renaming.name}
                      maxLength={60}
                      onChange={(e) => setRenaming({ id: k.id, name: e.target.value })}
                      autoFocus
                    />
                    <button className="btn sec sm" type="submit">
                      Save
                    </button>
                    <button className="btn ghost sm" type="button" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <span className="row" style={{ gap: 8 }}>
                    <b>{k.name}</b>
                    <span className="tag">{k.synced ? "SYNCED" : "DEVICE-BOUND"}</span>
                  </span>
                )}
                <span className="lbl">
                  added <span className="mono">{fmtDate(k.createdAt)}</span>
                </span>
              </div>
              <span className="k-when ident">{k.lastUsed ? `used ${fmtTime(k.lastUsed)}` : "not used yet"}</span>
              <div className="row" style={{ gap: 10 }}>
                <button className="txt" onClick={() => setRenaming({ id: k.id, name: k.name })}>
                  Rename
                </button>
                <button
                  className="txt bad"
                  onClick={() => press(k.id, () => act(() => panel.removePasskey(cred, k.id), `Removed “${k.name}”`))}
                >
                  {armed === k.id ? "Remove? Click again" : "Remove"}
                </button>
              </div>
            </div>
          ))}
          {keys && !keys.length && <p className="empty">No passkeys yet. Add one for this device.</p>}
          {!keys && <p className="empty">Loading…</p>}
        </div>

        <div className="card">
          <div className="card-h">
            <h2 className="h2">Rules</h2>
          </div>
          <div className="setting">
            <div>
              <b>Passkeys only</b>
              <span>The admin token stops working</span>
            </div>
            <Switch
              on={tokenOff}
              blocking
              label="Passkeys only"
              disabled={!settings || (!tokenOff && !keys?.length)}
              set={(v) =>
                settings &&
                act(
                  () => saveSettings({ ...settings, tokenSignIn: !v }),
                  v ? "Passkeys only: the token is off" : "The token works again",
                )
              }
            />
          </div>
          <div className="health" style={{ minHeight: 56 }}>
            <span className={`hd ${backup ? "" : "warn"}`} />
            <span>
              <b style={{ fontWeight: 500, display: "block" }}>Backup passkey</b>
              <span className="lbl">{backup ? "Lose one device, still get in" : "Add a second passkey"}</span>
            </span>
            <span className={`v ${backup ? "" : "warn"}`}>{backup ? "in place" : "missing"}</span>
          </div>
          <div className="health" style={{ minHeight: 56 }}>
            <span className={`hd ${cred ? "warn" : ""}`} />
            <span>
              <b style={{ fontWeight: 500, display: "block" }}>This session</b>
              <span className="lbl">{cred ? "Signed in with the token" : "Signed in with a passkey"}</span>
            </span>
          </div>
        </div>

        <div className="card span2">
          <div className="card-h">
            <h2 className="h2">Sessions</h2>
            <button
              className="btn blk-o sm"
              disabled={!sessions?.some((s) => !s.current)}
              onClick={() => press("others", () => act(() => panel.endOthers(cred), "Signed out everywhere else"))}
            >
              {armed === "others" ? "Sure? Click again" : "Sign out everywhere else"}
            </button>
          </div>
          {sessions?.map((s) => (
            <div key={s.id} className="li">
              <div style={{ minWidth: 0 }}>
                <p>
                  {device(s.agent)}
                  {s.current && (
                    <span className="tag" style={{ marginLeft: 8 }}>
                      THIS DEVICE
                    </span>
                  )}
                </p>
                <p className="ident">
                  {s.ip || "address unknown"} · seen {ago(s.seenAt)} · since {fmtDate(s.createdAt)}
                </p>
              </div>
              {!s.current && (
                <button className="txt" onClick={() => act(() => panel.endSession(cred, s.id), "Signed out")}>
                  Sign out
                </button>
              )}
            </div>
          ))}
          {sessions && !sessions.length && <p className="empty">No passkey sessions.</p>}
        </div>

        <div className="card">
          <div className="card-h">
            <h2 className="h2">Sign-in log</h2>
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }} data-lenis-prevent>
            {log?.map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                className="li"
                style={{ flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 16px" }}
              >
                <span className="row" style={{ gap: 8 }}>
                  <span className={`chip ${e.ok ? "v-allow" : "v-block"}`}>{e.ok ? "allow" : "block"}</span>
                  <span className={e.ok ? "t2" : "err"}>{e.what}</span>
                </span>
                <span className="ident">
                  {fmtTime(e.at)}
                  {e.ip && ` · ${e.ip}`}
                </span>
              </div>
            ))}
            {log && !log.length && <p className="empty">Nothing yet.</p>}
          </div>
        </div>
      </div>
      <p className="lbl" style={{ marginTop: 10 }}>
        Addresses are kept as the network plus a salted hash, never in full.
      </p>

      {adding && (
        <Sheet label="Add a passkey" onClose={() => setAdding(null)}>
          <div>
            <p className="eyebrow">Step {adding.step === "name" ? 1 : adding.step === "waiting" ? 2 : 3} of 3</p>
            <h2>Add a passkey</h2>
          </div>
          {adding.step === "name" && (
            <>
              <div className="f">
                <label className="lbl" htmlFor="pk-n">
                  Name it after the device
                </label>
                <input
                  id="pk-n"
                  className="inp"
                  maxLength={60}
                  value={adding.name}
                  onChange={(e) => setAdding({ step: "name", name: e.target.value })}
                  placeholder="Work laptop"
                  autoFocus
                />
              </div>
              <p className="t2">So you know which one to remove if you lose it.</p>
              {adding.error && <p className="err">{adding.error}</p>}
              <div className="sheet-act">
                <button className="btn pri" onClick={register}>
                  Continue
                </button>
                <button className="btn ghost" onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
          {adding.step === "waiting" && (
            <div className="pk-wait" aria-live="polite">
              <span className="pk-ring">
                <KeyIcon />
              </span>
              <b>Confirm on your device</b>
              <p className="t2">Touch ID, Face ID, your phone or the security key. The browser shows its own prompt.</p>
            </div>
          )}
          {adding.step === "done" && (
            <div className="pk-wait" aria-live="polite" style={{ flex: 1 }}>
              <span className="pk-ring done">
                <svg
                  viewBox="0 0 16 16"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                </svg>
              </span>
              <b>Passkey added</b>
              <p className="t2">“{adding.name}” can now sign you in.</p>
              <div className="sheet-act" style={{ width: "100%" }}>
                <button className="btn pri" onClick={() => setAdding(null)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </Sheet>
      )}
    </section>
  );
}
