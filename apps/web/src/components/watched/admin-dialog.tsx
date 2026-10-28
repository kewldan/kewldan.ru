"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { adminApi } from "@/lib/watched";

/**
 * The footer's quiet "Admin" link: paste ADMIN_TOKEN once and this device
 * can add, edit and delete titles.
 */
export function AdminDialog({ token, onToken }: { token: string | null; onToken: (t: string | null) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (token) {
    return (
      <button onClick={() => onToken(null)} className="text-stage-chip hover:text-stage-fg">
        {t.admin.signOut}
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
      setErr(t.admin.wrong);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="text-stage-chip hover:text-stage-fg">{t.admin.link}</DialogTrigger>
      <DialogContent
        data-lenis-prevent
        className="rounded-[28px] border border-stage-frame bg-stage-tile p-7 font-stage text-stage-fg sm:max-w-md"
      >
        <DialogTitle className="text-2xl font-bold tracking-[-0.04em]">{t.admin.title}</DialogTitle>
        <DialogDescription className="text-stage-dim">{t.admin.body}</DialogDescription>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            autoComplete="current-password"
            aria-label={t.admin.token}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-stage-frame bg-stage-input px-3.5 font-mono text-[15px] text-stage-fg"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="pill" size="pill" disabled={busy || !value.trim()}>
              {busy ? t.admin.checking : t.admin.unlock}
            </Button>
            {err && (
              <p role="alert" className="font-medium text-[#ff453a]">
                {err}
              </p>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
