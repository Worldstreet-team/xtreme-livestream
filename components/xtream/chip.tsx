"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A chip: one filter among a scrolling row of them. Afterglow's "on" is
 * white with a soft glow (the same as an active tab); off is the quiet
 * charcoal control. A live dot is Chili (something is on air in there); a
 * count rides along muted, Ember when the chip is on. On a picture, chips
 * wear the object language instead of charcoal.
 *
 * `href` makes it a link (filters that live in the URL); otherwise a
 * toggle button with `aria-pressed`.
 */
export function Chip({
  children,
  active = false,
  live = false,
  count,
  href,
  onClick,
  onPicture = false,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  live?: boolean;
  count?: number | string | null;
  href?: string;
  onClick?: () => void;
  onPicture?: boolean;
  className?: string;
}) {
  const cls = cn(
    "press inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold whitespace-nowrap outline-none transition-[background-color,color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ember",
    active
      ? "bg-white text-[#0b0708]"
      : onPicture
        ? "bg-black/55 text-white/90 hover:bg-black/70"
        : "bg-control text-foreground/85 hover:bg-control-hover hover:text-foreground",
    className,
  );
  const inner = (
    <>
      {live && <span aria-hidden className="size-1.5 rounded-full bg-chili" />}
      {children}
      {count != null && count !== "" && (
        <span
          className={cn(
            "-mr-1 rounded-full px-1.5 py-0.5 text-[10.5px] leading-none font-bold tabular-nums",
            active ? "bg-ember text-on-ember" : "bg-white/[0.08] text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-current={active ? "true" : undefined} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/** A row of chips that scrolls sideways and bleeds to the screen edge on phones. */
export function ChipRow({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0", className)}
    >
      {children}
    </div>
  );
}
