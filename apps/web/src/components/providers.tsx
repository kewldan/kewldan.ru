"use client";

import { ReactLenis } from "lenis/react";
import { MotionConfig, useReducedMotion } from "motion/react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
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
  );
}
