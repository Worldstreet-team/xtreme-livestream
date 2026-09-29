"use client";

import { Suspense } from "react";
import { OnboardingFlow } from "@/components/app/welcome/onboarding-flow";

/**
 * The first-run flow: a moment, not a page — no rail, no top bar (the
 * sidebar's CHROMELESS list), the whole screen. See
 * components/app/welcome/onboarding-flow.tsx.
 */
export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlow />
    </Suspense>
  );
}
