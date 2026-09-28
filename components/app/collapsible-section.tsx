"use client";

import { useId, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { CaretRight } from "@/components/icons";
import { cn } from "@/lib/utils";

const KEY = (id: string) => `xtream:section:${id}`;
const EVENT = "xtream:section";
/** This page's own memory, for a browser that won't keep it. */
const mem = new Map<string, "1" | "0">();

function readOpen(id: string): "1" | "0" | null {
  try {
    const v = localStorage.getItem(KEY(id));
    if (v === "1" || v === "0") return v;
  } catch {
    // Storage blocked: the page's own memory.
  }
  return mem.get(id) ?? null;
}

/** Open a section from elsewhere — a tip that leads to it, say — and remember it open. */
export function openSection(id: string) {
  mem.set(id, "1");
  try {
    localStorage.setItem(KEY(id), "1");
  } catch {
    // Remembered for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * A studio section that folds away: its name and one line of what it's set
 * to, so the setup screen and the room's panels stay short and a host
 * opens only what they're changing. Each remembers, in this browser,
 * whether it was left open.
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  icon: Icon,
  defaultOpen = false,
  className,
  children,
}: {
  /** Where its open-or-closed is remembered. */
  id: string;
  title: string;
  /** What it's set to, in a few words — shown while it's closed and open alike. */
  summary?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  // The default on the server's paint; what this browser remembers once it's here.
  const stored = useSyncExternalStore(subscribe, () => readOpen(id), () => null);
  const open = stored === null ? defaultOpen : stored === "1";
  const bodyId = useId();
  const toggle = () => {
    if (!open) return openSection(id);
    mem.set(id, "0");
    try {
      localStorage.setItem(KEY(id), "0");
    } catch {
      // Remembered for this page only.
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <section className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="press flex w-full items-center gap-3 rounded-[12px] px-1 py-1.5 text-left transition-colors hover:bg-tint/[0.04]"
      >
        {Icon && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint/[0.07]">
            <Icon size={17} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold">{title}</span>
          {summary && <span className="block truncate text-[12.5px] text-muted-foreground">{summary}</span>}
        </span>
        <CaretRight size={15} className={cn("shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
      </button>
      <div id={bodyId} hidden={!open} className="pt-3">
        {children}
      </div>
    </section>
  );
}
