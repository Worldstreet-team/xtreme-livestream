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
  // A trigger in the top half (the top bar's bell) opens downward, under
  // it and lined up with its right edge; one lower down (the rail's
  // account row) opens beside it, growing up from its foot.
  const fromTop = anchor.top + anchor.height / 2 < window.innerHeight / 2;
  const style: React.CSSProperties = isMobile
    ? { position: "fixed", left: 16, right: 16, bottom: 24 }
    : fromTop
      ? {
          position: "fixed",
          top: anchor.bottom + 10,
          left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)),
          width,
          maxHeight: `calc(100vh - ${Math.round(anchor.bottom + 26)}px)`,
        }
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
        "animate-rise z-[70] overflow-hidden rounded-panel bg-popover shadow-popover",
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
