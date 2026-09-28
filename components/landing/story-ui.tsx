import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The landing page's shared grammar. The page is a story told in chapters
 * (go live, get backed, get paid, wear the pelt, keep the room, just ask),
 * each opened by the same header: a mono eyebrow, a display title set wide
 * and revealed line by line, and a paragraph that sits on its baseline.
 *
 * Most chapters sit on the warm ground. A few sit on PAPER, a warm light
 * ground used only on this page, so the story has the dark/light rhythm of
 * an editorial site without the product itself ever leaving dark mode.
 *
 * Motion is declared here as data attributes (`data-reveal`, `data-scrub`,
 * `data-parallax`) and run by <ScrollMotion>, with the styles in motion.css.
 */

/** The light ground and its ink: landing only, the product stays dark. */
export const PAPER = "bg-[#f3ece6] text-[#0b0708]";
export const INK_MUTED = "text-[#6b605c]";
/** The eyebrow colour on paper: ember deepened until it reads on light (4.9:1). */
export const EMBER_ON_PAPER = "text-[#c2410c]";

/** The page gutter and the section rhythm, used by every chapter. */
export const GUTTER = "px-5 sm:px-8 lg:px-20";
export const SECTION_Y = "py-24 sm:py-32 lg:py-40";

/** A per-element delay for a reveal, in ms. */
export const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/**
 * A section's label, as a soft pill (owner, 2026-09-27: a more modern
 * styling than spaced-out mono caps). "02 / Get backed" puts the chapter
 * number in a small solid badge; "For the room / Earn" gets a dot, the
 * first part quieter and the last part in ink; plain text is just the dot
 * and the words. `accent` colours the badge or dot (gold for the Wolf race).
 */
export function Eyebrow({
  children,
  onPaper = false,
  accent = "ember",
  className,
}: {
  children: ReactNode;
  onPaper?: boolean;
  accent?: "ember" | "gold";
  className?: string;
}) {
  const text = typeof children === "string" ? children : null;
  const parts = text ? text.split(" / ") : [];
  const num = parts.length > 1 && /^\d+$/.test(parts[0]) ? parts[0] : null;
  const rest = num ? parts.slice(1) : parts;
  const pre = rest.length > 1 ? rest.slice(0, -1).join(" / ") : null;
  const label = text ? rest[rest.length - 1] : children;
  const solid = accent === "gold" ? "bg-[#EAB308] text-[#1b1406]" : "bg-ember text-[#1b0a04]";
  return (
    <p
      data-reveal="up"
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-2 rounded-full py-1 pr-3.5 pl-1 text-[13.5px] leading-none font-semibold tracking-[-0.01em]",
        onPaper ? "bg-[#0b0708]/[0.055] text-[#0b0708]" : "bg-white/[0.07] text-foreground",
        className,
      )}
    >
      {num ? (
        <span className={cn("grid h-6 min-w-6 place-items-center rounded-full px-1.5 font-mono text-[11px] font-bold tabular-nums", solid)}>{num}</span>
      ) : (
        <span aria-hidden className={cn("mx-1.5 size-1.5 shrink-0 rounded-full", solid)} />
      )}
      {pre && (
        <>
          <span className={onPaper ? "text-[#0b0708]/55" : "text-foreground/55"}>{pre}</span>
          <span aria-hidden className="opacity-30">
            /
          </span>
        </>
      )}
      <span className="truncate">{label}</span>
    </p>
  );
}

/**
 * The lines of a display title, each in its own mask so it can rise into
 * place. A line may be a string or any node (the Vivid chapter's middle
 * line is a single shimmering word).
 *
 * String lines are also split into letters (`lm-ch`, numbered across the
 * whole title in `--c`), so the scroll motion can bring a title in a letter
 * at a time, out of a blur (scroll-stage.css). Words stay unbroken, and
 * screen readers get the line whole: the letters are hidden from them.
 */
export function Lines({ lines }: { lines: ReactNode[] }) {
  let c = 0;
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} className="lm-line" style={{ "--i": i } as CSSProperties}>
          <span>
            {typeof line === "string" ? (
              <>
                <span className="sr-only">{line}</span>
                <span aria-hidden>
                  {line.split(" ").map((word, w) => (
                    <span key={w} className="lm-word-box">
                      {w > 0 && " "}
                      <span className="inline-block whitespace-nowrap">
                        {[...word].map((ch, k) => (
                          <span key={k} className="lm-ch" style={{ "--c": c++ } as CSSProperties}>
                            {ch}
                          </span>
                        ))}
                      </span>
                    </span>
                  ))}
                </span>
              </>
            ) : (
              <span className="lm-ch" style={{ "--c": c++ } as CSSProperties}>
                {line}
              </span>
            )}
          </span>
        </span>
      ))}
    </>
  );
}

/** A chapter's display title: wide Archivo, tight, one mask per line. */
export function ChapterTitle({
  id,
  lines,
  className,
  as: Tag = "h2",
}: {
  id?: string;
  lines: ReactNode[];
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <Tag
      id={id}
      data-reveal="lines"
      className={cn("font-wide text-[clamp(2.75rem,5.6vw,4.75rem)] leading-[0.94] font-bold tracking-[-0.045em]", className)}
    >
      <Lines lines={lines} />
    </Tag>
  );
}

export function ChapterHead({
  id,
  eyebrow,
  title,
  body,
  onPaper = false,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: ReactNode[];
  body?: ReactNode;
  onPaper?: boolean;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16", className)}>
      <div className="flex flex-col gap-6">
        <Eyebrow onPaper={onPaper}>{eyebrow}</Eyebrow>
        <ChapterTitle id={id ? `${id}-title` : undefined} lines={title} />
      </div>
      {body && (
        <p
          data-reveal="up"
          style={delay(250)}
          className={cn("max-w-[26rem] text-[17px] leading-[1.55]", onPaper ? INK_MUTED : "text-muted-foreground")}
        >
          {body}
        </p>
      )}
    </header>
  );
}

/** A row of short feature notes under a chapter's picture, hairline above each. */
export function FeatureNotes({ items, onPaper = false }: { items: Array<[string, string]>; onPaper?: boolean }) {
  return (
    <ul data-reveal="stagger" className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([title, body]) => (
        <li key={title} className={cn("lm-rule flex flex-col gap-2.5 pt-6", onPaper ? "before:bg-black/15" : "before:bg-hairline")}>
          <h3 className="text-[18px] font-semibold">{title}</h3>
          <p className={cn("text-[15px] leading-[1.55]", onPaper ? INK_MUTED : "text-muted-foreground")}>{body}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * A product picture drawn in code rather than a screenshot: it's the real
 * grammar (tally, lower third, scoreboard, receipts), at any size, in any
 * language. The values in it are an example, so assistive tech gets the
 * one-line description instead of a wall of sample numbers. It opens with
 * a clip-path wipe as it scrolls in.
 */
export function Illustration({ label, className, reveal = true, children }: { label: string; className?: string; reveal?: boolean; children: ReactNode }) {
  // `reveal={false}`: no scroll motion of its own (a group around it already has one).
  return (
    <figure role="img" aria-label={label} data-reveal={reveal ? "media" : undefined} className={className}>
      <div aria-hidden className="contents">
        {children}
      </div>
    </figure>
  );
}
