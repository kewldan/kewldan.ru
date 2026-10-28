"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { adminApi } from "@/lib/watched";

/**
 * The footer's quiet "Admin" link: paste ADMIN_TOKEN once and this device
 * can add, edit and delete titles.
 */
export function AdminDialog({ token, onToken }: { token: string | null; onToken: (t: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (token) {
    return (
      <button onClick={() => onToken(null)} className="text-stage-chip hover:text-white">
        Sign out of editing
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await adminApi.check(value.trim());
      onToken(value.trim());
      setOpen(false);
      setValue("");
    } catch {
      setErr("That token doesn’t work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="text-stage-chip hover:text-white">Admin</DialogTrigger>
      <DialogContent
        data-lenis-prevent
        className="rounded-[28px] border border-stage-frame bg-stage-tile p-7 font-stage text-stage-fg sm:max-w-md"
      >
        <DialogTitle className="text-2xl font-bold tracking-[-0.04em]">Edit the list</DialogTitle>
        <DialogDescription className="text-stage-dim">
          Paste the admin token. It stays on this device until you sign out.
        </DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Admin token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-stage-frame bg-[#1c1c1f] px-3.5 font-mono text-[15px] text-stage-fg"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="pill" size="pill" disabled={busy || !value.trim()}>
              {busy ? "Checking…" : "Unlock"}
            </Button>
            {err && (
              <p role="alert" className="font-medium text-[#ff6961]">
                {err}
              </p>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
