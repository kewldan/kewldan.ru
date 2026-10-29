"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { adminApi, type Credential, passkeys } from "@/lib/watched";

import { KeyIcon, Mark } from "./ui";

/** The browser's "user closed the prompt" error. */
const cancelled = (err: unknown) => err instanceof Error && err.name === "NotAllowedError";

/** A passkey; the admin token as the fallback and the way in before the first passkey. */
export function SignIn({ onSignIn }: { onSignIn: (c: Credential) => void }) {
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    passkeys.available().then(setHasPasskey, () => setHasPasskey(false));
  }, []);

  const withPasskey = async () => {
    setBusy(true);
    setErr("");
    try {
      await passkeys.signIn();
      onSignIn(null);
    } catch (e) {
      setErr(cancelled(e) ? "Cancelled. Try again when ready." : "That passkey did not work.");
    } finally {
      setBusy(false);
    }
  };

  const withToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await adminApi.check(token.trim());
      onSignIn(token.trim());
    } catch {
      setErr("That token is not right, or token sign-in is off.");
    } finally {
      setBusy(false);
    }
  };

  const tokenOpen = showToken || hasPasskey === false;

  return (
    <div className="gate">
      <div className="card">
        <div className="pad" style={{ gap: 18, padding: 24 }}>
          <div className="row" style={{ gap: 12 }}>
            <span style={{ width: 26, height: 26, display: "inline-flex" }}>
              <Mark />
            </span>
            <b style={{ fontWeight: 600, fontSize: 14 }}>
              kewldan{" "}
              <span className="t3" style={{ fontWeight: 400 }}>
                admin
              </span>
            </b>
          </div>
          <div>
            <h1 className="h1">Sign in</h1>
            <p className="lead">
              {hasPasskey === false
                ? "No passkey yet: sign in with the admin token once, then add one under Security."
                : "With the passkey on this device: Touch ID, Face ID, your phone or a security key."}
            </p>
          </div>
          {hasPasskey && (
            <button className="btn pri" onClick={withPasskey} disabled={busy}>
              <KeyIcon />
              {busy && !tokenOpen ? "Waiting for the device…" : "Sign in with a passkey"}
            </button>
          )}
          {tokenOpen ? (
            <form className="f" onSubmit={withToken}>
              <label className="lbl" htmlFor="tok">
                Admin token
              </label>
              <input
                id="tok"
                className="inp mono"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <div className="row" style={{ marginTop: 6 }}>
                <button className={hasPasskey ? "btn sec" : "btn pri"} type="submit" disabled={busy || !token.trim()}>
                  {busy ? "Checking…" : "Unlock"}
                </button>
              </div>
            </form>
          ) : (
            hasPasskey && (
              <button className="txt" style={{ alignSelf: "flex-start" }} onClick={() => setShowToken(true)}>
                Use the admin token instead
              </button>
            )
          )}
          {err && (
            <p role="alert" className="err">
              {err}
            </p>
          )}
          <Link className="txt" href="/" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
            ← kewldan.ru
          </Link>
        </div>
      </div>
    </div>
  );
}
