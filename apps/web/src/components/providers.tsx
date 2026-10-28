"use client";

import { ReactLenis } from "lenis/react";
import { MotionConfig, useReducedMotion } from "motion/react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { I18nProvider } from "@/i18n/provider";

export function Providers({ locale, t, children }: { locale: Locale; t: Dictionary; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <I18nProvider locale={locale} t={t}>
      <MotionConfig reducedMotion="user">
        {!reduced && (
          <ReactLenis
            root
            options={{
              lerp: 0.1,
              wheelMultiplier: 1,
              // Smooth in-page anchors, clearing the floating nav.
              anchors: { offset: -72 },
            }}
          />
        )}
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="bottom-center" />
      </MotionConfig>
    </I18nProvider>
  );
}
