"use client";

import { Tooltip as Primitive } from "radix-ui";
import type { ReactNode } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <Primitive.Provider delayDuration={400}><Primitive.Root><Primitive.Trigger asChild>{children}</Primitive.Trigger><Primitive.Portal><Primitive.Content sideOffset={8} className="z-[var(--layer-tooltip)] max-w-64 rounded-control bg-foreground px-3 py-2 text-xs text-background shadow-floating">{label}<Primitive.Arrow className="fill-foreground" /></Primitive.Content></Primitive.Portal></Primitive.Root></Primitive.Provider>;
}
