"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The reference's own parts. The page is a lookbook, not a manual: every
 * section opens on the component doing its job — on a picture when that's
 * where it lives — and the wiring sits beside it, one copy away.
 */

/** A chapter. `act` is the small label over the title. */
export function Section({
  id,
  act,
  title,
  intro,
  children,
}: {
  id: string;
  act: string;
  title: ReactNode;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 pt-20 md:pt-28">
      <div className="flex items-baseline justify-between gap-4 border-t border-hairline pt-4">
        <span className="caps font-mono text-[10.5px] text-muted-foreground">{act}</span>
        <a href="#top" className="font-mono text-[10.5px] text-muted-foreground/70 hover:text-foreground">
          Back to top ↑
        </a>
      </div>
      <h2 id={`${id}-title`} className="ds-display mt-6 max-w-[16ch] text-[clamp(2.25rem,5vw,3.75rem)] leading-[0.98] text-balance">
        {title}
      </h2>
      <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-foreground/72 text-pretty">{intro}</p>
      <div className="mt-10 grid gap-5">{children}</div>
    </section>
  );
}

/**
 * Where a demo plays. `picture` puts it on a live frame (the object
 * language's home) under a scrim; otherwise the warm ground. Links inside
 * never navigate — the demos are for touching, not leaving.
 */
export function Stage({
  picture,
  className,
  children,
  scrim = "medium",
}: {
  picture?: string;
  className?: string;
  children: ReactNode;
  scrim?: "light" | "medium" | "heavy";
}) {
  return (
    <div
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("a")) e.preventDefault();
      }}
      className={cn("relative isolate overflow-hidden", picture ? "bg-black" : "bg-ground", className)}
    >
      {picture && (
        <>
          <span aria-hidden className="absolute inset-0 -z-20 bg-cover bg-center" style={{ backgroundImage: `url(${picture})` }} />
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 -z-10",
              scrim === "light" && "bg-[linear-gradient(180deg,rgba(0,0,0,0.35),rgba(0,0,0,0.15)_40%,rgba(0,0,0,0.55))]",
              scrim === "medium" && "bg-[linear-gradient(180deg,rgba(0,0,0,0.55),rgba(0,0,0,0.3)_45%,rgba(0,0,0,0.75))]",
              scrim === "heavy" && "bg-black/72",
            )}
          />
        </>
      )}
      {children}
    </div>
  );
}

/**
 * One component: the demo on the left, what it is and how to wire it on the
 * right. `wide` gives the demo the full width and puts the notes under it.
 */
export function Spec({
  name,
  from,
  summary,
  rules,
  wire,
  stage,
  wide = false,
  children,
}: {
  name: string;
  /** Where the idea came from, if borrowed — "On Air", "Gold Floor". */
  from?: string;
  summary: ReactNode;
  rules?: ReactNode[];
  wire: string;
  /** Classes for the demo area — a picture, padding, min height. */
  stage?: { picture?: string; className?: string; scrim?: "light" | "medium" | "heavy" };
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        "grid min-w-0 overflow-hidden rounded-panel bg-surface shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)]",
        !wide && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]",
      )}
    >
      <Stage picture={stage?.picture} scrim={stage?.scrim} className={cn("min-h-[220px] p-5 md:p-7", stage?.className)}>
        {children}
      </Stage>
      <div className={cn("flex min-w-0 flex-col gap-4 border-t border-hairline p-5 md:p-6", !wide && "lg:border-t-0 lg:border-l")}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="font-wide text-[20px] leading-tight font-bold tracking-[-0.025em]">{name}</h3>
          {from && (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              borrowed from {from}
            </span>
          )}
        </div>
        <p className="text-[14.5px] leading-relaxed text-foreground/72">{summary}</p>
        {rules && rules.length > 0 && (
          <ul className="grid gap-2 text-[13.5px] leading-snug text-foreground/80">
            {rules.map((r, i) => (
              <li key={i} className="flex gap-2.5">
                <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ember" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
        <Code>{wire}</Code>
      </div>
    </article>
  );
}

/** The wiring: the import and the call, one tap to copy. */
export function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-auto min-w-0 rounded-[14px] bg-ground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)]">
      <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2">
        <span className="caps font-mono text-[9.5px] text-muted-foreground">Wire it</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(children).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              },
              () => {},
            );
          }}
          className="press flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          {copied ? <Check size={12} weight="bold" className="text-ember-hi" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-w-full p-3.5 font-mono text-[11.5px] leading-[1.65] break-words whitespace-pre-wrap text-foreground/85">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/** A row of the same component in each of its states, captioned. */
export function States({ items, className }: { items: { label: string; node: ReactNode; hint?: string }[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col items-center justify-end gap-3 text-center">
          <div className="flex min-h-[64px] items-center justify-center">{it.node}</div>
          <span className="caps font-mono text-[9.5px] text-white/60">
            {it.label}
            {it.hint && <em className="ml-1 not-italic text-ember-hi">{it.hint}</em>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A small caption in the demo area — "example content", a state name. */
export function StageNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("caps font-mono text-[9.5px] text-white/55", className)}>{children}</p>;
}
