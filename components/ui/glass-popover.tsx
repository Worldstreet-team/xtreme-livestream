"use client";

import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A floating glass panel anchored beside a trigger element.
 *
 * Portaled to <body> on purpose: the sidebar island is a blurred, scrolling,
 * (on mobile) transformed container — absolutely-positioned children get
 * clipped by its overflow, and `fixed` children anchor to the transform
 * instead of the viewport. The portal sidesteps every one of those traps.
 *
 * Desktop: floats to the anchor's right, bottom-aligned with it.
 * Mobile: a bottom sheet, inset from the screen edges.
 *
 * Outside-click closers must treat clicks inside `[data-glass-popover]` as
 * inside — the panel is no longer a DOM child of its trigger.
 */
export function GlassPopover({
  anchor,
  width = 300,
  className,
  children,
}: {
  /** The trigger's rect, captured when the popover opened. */
  anchor: DOMRect;
  width?: number;
  className?: string;
  children: React.ReactNode;
}) {
  if (typeof document === "undefined") return null;

  const isMobile = window.innerWidth < 768;
  const style: React.CSSProperties = isMobile
    ? { position: "fixed", left: 16, right: 16, bottom: 24 }
    : {
        position: "fixed",
        left: Math.min(anchor.right + 20, window.innerWidth - width - 16),
        bottom: Math.max(12, window.innerHeight - anchor.bottom),
        width,
      };

  return createPortal(
    <div
      data-glass-popover
      style={style}
      className={cn(
        "animate-rise z-[70] overflow-hidden rounded-xl border border-white/[0.08] bg-[oklch(0.15_0.005_285)]/95 shadow-[0_16px_50px_-16px_rgba(0,0,0,0.85)] backdrop-blur-2xl",
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}

/** True when a pointer event landed inside any portaled glass popover. */
export function insideGlassPopover(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof Element && target.closest("[data-glass-popover]")
  );
}
