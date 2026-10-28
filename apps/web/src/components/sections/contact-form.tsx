"use client";

import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ContactChallenge } from "@/lib/api/generated/ContactChallenge";
import type { ContactInput } from "@/lib/api/generated/ContactInput";
import { t } from "@/lib/copy";
import { ease, spring } from "@/lib/motion";
import { solve } from "@/lib/proof-of-work";
import { cn } from "@/lib/utils";

type Errors = typeof t.contactForm.errors;
type Proof = { id: string; nonce: string; at: number };

/** The API holds a reply this soon after its challenge for a script. */
const MIN_FILL_MS = 3200;

async function fetchProof(): Promise<Proof> {
  const res = await fetch("/api/contact/challenge");
  if (!res.ok) throw new Error(res.status === 429 ? "rate" : "unavailable");
  const c = (await res.json()) as ContactChallenge;
  return { id: c.id, nonce: await solve(c.id, c.difficulty), at: Date.now() };
}

const field =
  "w-full rounded-xl border border-stage-frame bg-stage-input px-3.5 py-3 text-[16px] text-stage-fg transition-colors placeholder:text-stage-dim focus:border-stage-link focus:outline-none aria-invalid:border-[#ff453a]";

/**
 * A message straight to Daniel's Telegram. The proof of work the API asks
 * for starts as soon as the form opens, so it is usually done before the
 * visitor is.
 */
export function ContactForm() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<keyof Errors | null>(null);
  const [form, setForm] = useState({ name: "", contact: "", message: "", website: "" });
  const proof = useRef<Promise<Proof> | null>(null);

  const prepare = () => {
    proof.current = fetchProof();
    // Kept for later; an early failure is reported on send.
    proof.current.catch(() => {});
  };

  const toggle = () => {
    if (!open && !proof.current) prepare();
    setOpen((o) => !o);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      for (let attempt = 0; ; attempt++) {
        proof.current ??= fetchProof();
        const p = await proof.current;
        proof.current = null;
        const wait = p.at + MIN_FILL_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const body: ContactInput = { challenge: p.id, nonce: p.nonce, ...form };
        const res = await fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setSent(true);
          setForm({ name: "", contact: "", message: "", website: "" });
          return;
        }
        const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
        // A challenge that expired or was spent: one fresh try.
        if ((code === "challenge" || code === "too_fast") && attempt === 0) continue;
        setError(code && code in t.contactForm.errors ? (code as keyof Errors) : "failed");
        return;
      }
    } catch (err) {
      const code = (err as Error).message;
      setError(code in t.contactForm.errors ? (code as keyof Errors) : "failed");
    } finally {
      setBusy(false);
      prepare();
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const invalid = (k: keyof Errors) => error === k || undefined;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <button onClick={toggle} aria-expanded={open} className="py-2 text-[15px] text-stage-link hover:underline">
        {t.contactForm.open} {open ? "↑" : "↓"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.45, ease: ease.out }}
            className="w-full max-w-130 overflow-hidden"
          >
            <AnimatePresence mode="wait" initial={false}>
              {sent ? (
                <motion.div
                  key="sent"
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={spring.layout}
                  className="flex flex-col items-center gap-4 rounded-[28px] bg-stage-tile px-6 py-10"
                >
                  <motion.span
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ ...spring.toss, delay: 0.1 }}
                    className="grid size-14 place-items-center rounded-full bg-live text-white"
                  >
                    <CheckIcon className="size-7" strokeWidth={3} />
                  </motion.span>
                  <p className="text-xl font-semibold">{t.contactForm.sent}</p>
                  <button onClick={() => setSent(false)} className="text-sm text-stage-link hover:underline">
                    {t.contactForm.another}
                  </button>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  onSubmit={submit}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-3 rounded-[28px] bg-stage-tile p-5 text-left md:p-6"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      aria-label={t.contactForm.name}
                      placeholder={t.contactForm.name}
                      autoComplete="name"
                      maxLength={80}
                      required
                      value={form.name}
                      onChange={set("name")}
                      aria-invalid={invalid("name")}
                      className={field}
                    />
                    <input
                      aria-label={t.contactForm.contact}
                      placeholder={t.contactForm.contactHint}
                      autoComplete="email"
                      maxLength={120}
                      required
                      value={form.contact}
                      onChange={set("contact")}
                      aria-invalid={invalid("contact")}
                      className={field}
                    />
                  </div>
                  <textarea
                    aria-label={t.contactForm.message}
                    placeholder={t.contactForm.messageHint}
                    rows={5}
                    maxLength={2000}
                    required
                    value={form.message}
                    onChange={set("message")}
                    aria-invalid={invalid("message") || invalid("links")}
                    data-lenis-prevent
                    className={cn(field, "min-h-32 resize-y leading-[1.45]")}
                  />
                  {/* The honeypot: off-screen for people, a field like any other for bots. */}
                  <input
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden
                    value={form.website}
                    onChange={set("website")}
                    className="absolute -left-[9999px] h-0 w-0 opacity-0"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p role="alert" className="min-h-5 text-sm text-[#ff6961]">
                      {error && t.contactForm.errors[error]}
                    </p>
                    <Button type="submit" variant="pill" size="pill" disabled={busy}>
                      {busy ? t.contactForm.sending : t.contactForm.send}
                    </Button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
