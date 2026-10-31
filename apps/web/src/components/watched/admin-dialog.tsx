"use client";

import { FingerprintIcon, KeyRoundIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/components/lang";
import { ease } from "@/lib/motion";
import { adminApi, type Credential, deviceName, passkeys } from "@/lib/watched";

/** The browser's "user closed the prompt" error. */
const cancelled = (err: unknown) => err instanceof Error && err.name === "NotAllowedError";

type Props = {
  admin: boolean;
  token: Credential;
  /** `null` when signed in with a passkey (the session is a cookie). */
  onSignIn: (token: Credential) => void;
  onSignOut: () => void;
};

/**
 * The footer's quiet "Admin" link. Signs in with a passkey; the admin token
 * is the fallback, and the way in before the first passkey exists.
 */
export function AdminDialog({ admin, token, onSignIn, onSignOut }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  if (admin) {
    const addPasskey = async () => {
      setAdding(true);
      try {
        await passkeys.register(token, deviceName());
        toast(t.admin.passkeyAdded);
      } catch (e) {
        if (!cancelled(e)) toast(t.admin.passkeyFailed);
      } finally {
        setAdding(false);
      }
    };
    const signOut = async () => {
      await passkeys.signOut().catch(() => {});
      onSignOut();
    };
    return (
      <div className="flex gap-4">
        <button
          onClick={addPasskey}
          disabled={adding}
          className="text-stage-chip hover:text-stage-fg disabled:opacity-60"
        >
          {adding ? t.admin.addingPasskey : t.admin.addPasskey}
        </button>
        <button onClick={signOut} className="text-stage-chip hover:text-stage-fg">
          {t.admin.signOut}
        </button>
      </div>
    );
  }

  const openChange = (next: boolean) => {
    setOpen(next);
    setErr("");
    if (!next) return;
    setShowToken(false);
    passkeys.available().then(setHasPasskey, () => setHasPasskey(false));
  };

  const done = (credential: Credential) => {
    onSignIn(credential);
    setOpen(false);
    setValue("");
    toast(t.admin.signedIn);
  };

  const signInWithPasskey = async () => {
    setBusy(true);
    setErr("");
    try {
      await passkeys.signIn();
      done(null);
    } catch (e) {
      setErr(cancelled(e) ? t.admin.cancelled : t.admin.passkeyFailed);
    } finally {
      setBusy(false);
    }
  };

  const signInWithToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await adminApi.check(value.trim());
      done(value.trim());
    } catch {
      setErr(t.admin.wrong);
    } finally {
      setBusy(false);
    }
  };

  // Before the first passkey exists the token is the only way in.
  const tokenOpen = showToken || hasPasskey === false;

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger className="text-stage-chip hover:text-stage-fg">{t.admin.link}</DialogTrigger>
      <DialogContent
        data-lenis-prevent
        className="rounded-[28px] border border-stage-frame bg-stage-tile p-7 font-stage text-stage-fg sm:max-w-md"
      >
        <DialogTitle className="text-2xl font-bold tracking-[-0.04em]">{t.admin.title}</DialogTitle>
        <DialogDescription className="text-stage-dim">
          {hasPasskey === false ? t.admin.firstTime : t.admin.body}
        </DialogDescription>

        {hasPasskey && (
          <Button variant="pill" size="pill" onClick={signInWithPasskey} disabled={busy} className="w-full">
            <FingerprintIcon className="size-5" />
            {busy && !tokenOpen ? t.admin.waiting : t.admin.passkey}
          </Button>
        )}

        <AnimatePresence initial={false}>
          {tokenOpen ? (
            <motion.form
              key="token"
              onSubmit={signInWithToken}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: ease.out }}
              className="flex flex-col gap-3 overflow-hidden"
            >
              {hasPasskey && <p className="text-sm text-stage-dim">{t.admin.tokenBody}</p>}
              <input
                type="password"
                autoComplete="current-password"
                aria-label={t.admin.token}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-stage-frame bg-stage-input px-3.5 font-mono text-[15px] text-stage-fg"
              />
              <Button
                type="submit"
                variant={hasPasskey ? "ghost" : "pill"}
                size="pill"
                disabled={busy || !value.trim()}
                className="self-start"
              >
                {busy ? t.admin.checking : t.admin.unlock}
              </Button>
            </motion.form>
          ) : (
            hasPasskey && (
              <button
                key="use-token"
                onClick={() => setShowToken(true)}
                className="inline-flex items-center gap-2 self-start text-sm text-stage-link hover:underline"
              >
                <KeyRoundIcon className="size-4" />
                {t.admin.useToken}
              </button>
            )
          )}
        </AnimatePresence>

        {err && (
          <p role="alert" className="font-medium text-[#ff453a]">
            {err}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
