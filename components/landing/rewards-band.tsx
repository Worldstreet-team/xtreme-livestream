"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Fire, Lightning, SealCheck, Target, Trophy, Wallet } from "@/components/icons";
import { cn } from "@/lib/utils";
import { BoxPattern } from "./box-pattern";
import { ChapterTitle, EMBER_ON_PAPER, Eyebrow, INK_MUTED, PAPER, delay } from "./story-ui";
import styles from "./rewards.module.css";

/**
 * The coda to the money chapters: what the room gets, in two halves
 * (owner, 2026-09-27). The title already read as two beats, so it splits:
 *
 *   Show up.   dark: how points come in. The week's streak, today's
 *              quests, calling it in a prediction.
 *   Level up.  what they become. Your level, cashing out to the wallet,
 *              the milestones you keep.
 *
 * Both halves run the same flow (eyebrow, title, line, then one big Ember
 * card over two small ones) and share every piece. Show up sits on the
 * dark ground and Level up on paper (owner, 2026-09-27: "make the other
 * section white back in the rewards"); every piece has both tones (`T`).
 * Everything is the real system: points for watching, chatting and calling
 * it, never from a card; 1,000 pts = $1 into the wallet.
 *
 * Each card has a small story that plays once as its half comes into view
 * (rewards.module.css). Without JS or with reduced motion it's all at rest.
 */
type Tone = "dark" | "light";

const T = {
  dark: {
    ground: "bg-ground",
    card: "bg-surface",
    ink: "text-foreground",
    muted: "text-muted-foreground",
    accent: "text-ember-hi",
    track: "bg-control",
    rule: "border-hairline",
    chip: "bg-control",
    solid: "bg-white text-[#0b0708]",
  },
  light: {
    ground: PAPER,
    card: "bg-white ring-1 ring-[#0b0708]/[0.07]",
    ink: "text-[#0b0708]",
    muted: INK_MUTED,
    accent: EMBER_ON_PAPER,
    track: "bg-[#0b0708]/[0.08]",
    rule: "border-[#0b0708]/[0.08]",
    chip: "bg-[#0b0708]/[0.06]",
    solid: "bg-[#0b0708] text-white",
  },
} as const;

/** Plays a half once, when most of it is in view. */
function usePlay() {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = requestAnimationFrame(() => setArmed(true));
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        setPlay(true);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, []);
  return { ref, armed, play };
}

/** A number that climbs to its value when `on`, on the page's ease. */
function Count({ to, on, from = 0, ms = 1200, at = 400, format = (n: number) => n.toLocaleString("en-US") }: { to: number; on: boolean; from?: number; ms?: number; at?: number; format?: (n: number) => string }) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const t0 = performance.now() + at;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - t0) / ms));
      const e = 1 - Math.pow(1 - p, 5);
      setN(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, to, from, ms, at]);
  return <>{format(n)}</>;
}

const vars = (v: Record<string, string | number>) => v as CSSProperties;

function Card({ tone, i, className, children }: { tone: Tone; i: number; className?: string; children: ReactNode }) {
  return <div className={cn(styles.card, "flex flex-col rounded-panel p-6", T[tone].card, className)} style={vars({ "--c": i })}>{children}</div>;
}

function Caps({ tone, children, onEmber }: { tone: Tone; children: ReactNode; onEmber?: boolean }) {
  return <span className={cn("caps font-mono text-[11.5px]", onEmber ? "text-on-ember/80" : T[tone].muted)}>{children}</span>;
}

/* ================= Show up: how points come in ================= */

function Streak({ play }: { play: boolean }) {
  return (
    <div className={cn(styles.card, "flex min-h-[17rem] flex-col justify-between rounded-panel bg-ember p-7 text-on-ember")} style={vars({ "--c": 0 })}>
      <Caps tone="dark" onEmber>
        This week
      </Caps>
      <div className="flex flex-col gap-5">
        <span className="font-wide text-[clamp(2rem,3.2vw,2.75rem)] leading-none font-bold tracking-[-0.04em]">
          <Count to={6} on={play} at={450} ms={900} />-day streak
        </span>
        <div className="grid grid-cols-7 gap-2">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i} className="flex flex-col items-center gap-2">
              {i < 6 ? (
                <span data-lit className={cn(styles.day, "flex size-10 items-center justify-center rounded-full bg-on-ember/15")} style={vars({ "--i": i })}>
                  <Fire size={17} weight="fill" />
                </span>
              ) : (
                <span className={cn(styles.today, "flex size-10 items-center justify-center rounded-full border-2 border-dashed border-on-ember/45")}>
                  <Fire size={17} weight="fill" className="opacity-35" />
                </span>
              )}
              <span className="text-[12px] font-semibold opacity-75">{d}</span>
            </span>
          ))}
        </div>
        <span className="text-[14px] font-semibold">Watch tomorrow to make it seven.</span>
      </div>
    </div>
  );
}

function Quests({ tone }: { tone: Tone }) {
  const t = T[tone];
  return (
    <Card tone={tone} i={1} className="gap-3">
      <Caps tone={tone}>Today&apos;s quests</Caps>
      <div className={cn("relative flex flex-col gap-2 border-t pt-3", t.rule)}>
        <span className={cn("text-[15px] font-semibold", t.ink)}>Watch 30 minutes</span>
        <div className={cn("h-1.5 overflow-hidden rounded-full", t.track)}>
          <div className={cn(styles.fill, "h-full rounded-full bg-ember")} style={vars({ "--at": "450ms" })} />
        </div>
        <div className="flex items-center justify-between">
          <span className={cn("text-[13px]", t.muted)}>30 / 30 min · +50 pts</span>
          <span className={cn(styles.late, "rounded-full px-3 py-1.5 text-[12.5px] font-bold", t.solid)} style={vars({ "--at": "1500ms" })}>
            Claim
          </span>
        </div>
        <span aria-hidden className={cn(styles.float, "absolute top-2 right-0 font-mono text-[13px] font-bold", t.accent)} style={vars({ "--at": "1900ms" })}>
          +50 pts
        </span>
      </div>
      {[
        ["Chat in 3 streams", "+40 pts", true],
        ["Send your first gift", "+100 pts", false],
      ].map(([title, pts, done]) => (
        <div key={title as string} className={cn("flex items-center gap-3 border-t pt-3", t.rule)}>
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[14px] font-semibold", done ? t.muted : t.ink)}>{title}</span>
            <span className={cn("block text-[12.5px]", t.muted)}>{pts}</span>
          </span>
          {done ? <Check size={17} weight="bold" className={t.accent} /> : <span className={cn("font-mono text-[12px]", t.muted)}>0 / 1</span>}
        </div>
      ))}
    </Card>
  );
}

function CallIt({ tone, play, className }: { tone: Tone; play: boolean; className?: string }) {
  const t = T[tone];
  return (
    <Card tone={tone} i={2} className={cn("gap-3", className)}>
      <div className="flex items-center justify-between">
        <Caps tone={tone}>Call it</Caps>
        <Target size={17} className={t.accent} />
      </div>
      <p className={cn("text-[16px] leading-snug font-semibold", t.ink)}>Does BTC close above 91k tonight?</p>
      {[
        ["Yes, send it", 68, true],
        ["No, it rejects", 32, false],
      ].map(([label, pct, lead], k) => (
        <div key={label as string} className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[13px]">
            <span className={cn("font-medium", t.ink)}>{label}</span>
            <span className={cn("font-mono", lead ? t.accent : t.muted)}>
              <Count to={pct as number} on={play} at={500 + k * 120} ms={1100} />%
            </span>
          </div>
          <div className={cn("h-1.5 overflow-hidden rounded-full", t.track)}>
            <div className={cn(styles.fill, "h-full rounded-full", lead ? "bg-ember" : tone === "dark" ? "bg-foreground/35" : "bg-[#0b0708]/30")} style={vars({ width: `${pct}%`, "--at": `${500 + k * 120}ms` })} />
          </div>
        </div>
      ))}
      <span className={cn(styles.late, "mt-auto flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-semibold", t.chip, t.ink)} style={vars({ "--at": "1700ms" })}>
        <Lightning size={14} weight="fill" className={t.accent} /> You called it · <span className={t.accent}>+320 pts</span>
      </span>
    </Card>
  );
}

/* ================= Level up: what points become ================= */

function Level() {
  return (
    <div className={cn(styles.card, "flex min-h-[17rem] flex-col justify-between rounded-panel bg-ember p-7 text-on-ember")} style={vars({ "--c": 0 })}>
      <div className="flex items-center justify-between">
        <Caps tone="dark" onEmber>
          Your level
        </Caps>
        <Trophy size={18} weight="fill" />
      </div>
      <div className="flex flex-col gap-4">
        <span className="font-money text-[clamp(6rem,10vw,9rem)] leading-[0.9] tracking-[-0.06em]">
          {/* 11 rolls to 12 as the bar tops out. */}
          1
          <span className={styles.odo}>
            <span>
              <span>1</span>
              <span>2</span>
            </span>
          </span>
        </span>
        <div className="relative h-2 overflow-hidden rounded-full bg-on-ember/20">
          <div className={cn(styles.levelA, "absolute inset-0 rounded-full bg-on-ember")} />
          <div className={cn(styles.levelB, "absolute inset-y-0 left-0 w-[72%] rounded-full bg-on-ember")} />
        </div>
        <span className="text-[14px] font-semibold">1,240 pts to Level 13</span>
      </div>
    </div>
  );
}

function CashOut({ tone, play }: { tone: Tone; play: boolean }) {
  const t = T[tone];
  const gold = tone === "light" ? "text-[#9a6b12]" : "text-value";
  return (
    <Card tone={tone} i={1} className="gap-3">
      <div className="flex items-center justify-between">
        <Caps tone={tone}>Cash out</Caps>
        <Wallet size={17} className={t.accent} />
      </div>
      <span className={cn("font-money text-[30px] leading-none tracking-[-0.03em]", t.ink)}>
        <Count to={18400} on={play} at={350} ms={1300} /> <span className={cn("text-[15px]", t.muted)}>pts</span>
      </span>
      <span className={cn("text-[13px]", t.muted)}>1,000 pts = $1 · into your wallet</span>
      <div className={cn("relative mt-1 h-1.5 rounded-full", t.track)}>
        <div className={cn(styles.fill, "absolute inset-y-0 left-0 w-[90%] rounded-full bg-ember")} style={vars({ "--at": "700ms" })} />
        <span className={cn(styles.thumb, "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ember bg-white")} style={{ left: "90%" }} />
      </div>
      <div className="relative mt-auto h-10">
        <span className={cn(styles.early, "absolute inset-0 flex items-center justify-center rounded-full text-[13px] font-bold", t.solid)} style={vars({ "--at": "2000ms" })}>
          Cash out $18
        </span>
        <span className={cn(styles.late, "absolute inset-0 flex items-center justify-center gap-2 rounded-full text-[13px] font-semibold", t.chip, t.ink)} style={vars({ "--at": "2150ms" })}>
          <span className={cn("font-money", gold)}>$18.00</span> landed in your wallet
        </span>
      </div>
    </Card>
  );
}

function Milestones({ tone }: { tone: Tone }) {
  const t = T[tone];
  const won = tone === "dark" ? "bg-ember/20 text-ember-hi" : "bg-ember/15 text-[#c2410c]";
  return (
    <Card tone={tone} i={2} className="gap-3">
      <div className="flex items-center justify-between">
        <Caps tone={tone}>Milestones</Caps>
        <SealCheck size={17} className={t.accent} />
      </div>
      <p className={cn("text-[13px]", t.muted)}>Once each, ever. The firsts worth remembering.</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["First gift", true],
          ["First battle", true],
          ["7-day streak", true],
          ["Level 20", false],
        ].map(([label, got], i) => (
          <span
            key={label as string}
            data-won={got ? "" : undefined}
            className={cn(styles.badge, "flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px] font-semibold", got ? won : cn(t.chip, t.muted))}
            style={vars({ "--i": i })}
          >
            <span className={cn(styles.tick, "grid size-4 place-items-center")} style={vars({ "--i": i })}>
              {got ? <Check size={13} weight="bold" /> : <span className="size-1.5 rounded-full bg-current opacity-50" />}
            </span>
            {label as string}
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ================= the two halves ================= */

/** On phones only one half shows, so it can carry its own words for the whole band. */
type PhoneCopy = { eyebrow: string; title: string; line: string };

function Half({ side, tone, eyebrow, title, line, phone, children }: { side: "left" | "right"; tone: Tone; eyebrow: string; title: string; line: string; phone?: PhoneCopy; children: (play: boolean) => ReactNode }) {
  const { ref, armed, play } = usePlay();
  const t = T[tone];
  return (
    <div
      ref={ref}
      data-armed={armed ? "" : undefined}
      data-play={play ? "" : undefined}
      className={cn(styles.half, "relative isolate overflow-hidden py-24 sm:py-32 lg:py-36", t.ground,
        // Phones and tablets show only the dark half (owner, 2026-09-27).
        side === "right" && "max-lg:hidden", side === "right" && tone === "dark" && "lg:border-l lg:border-hairline",
        // Desktop: the two halves curve into each other (owner, 2026-09-27).
        side === "left" ? "lg:rounded-tr-[96px]" : "lg:rounded-bl-[96px]")}
    >
      <BoxPattern theme={tone === "dark" ? "streak" : "tiles"} corner={side === "left" ? "tl" : "br"} />
      <div
        className={cn(
          "flex w-full max-w-[45rem] flex-col gap-10 px-5 sm:px-8",
          side === "left" ? "ml-auto lg:pr-12 lg:pl-20" : "mr-auto lg:pr-20 lg:pl-12",
        )}
      >
        {phone && (
          <header className="flex flex-col gap-5 lg:hidden">
            <Eyebrow onPaper={tone === "light"}>{phone.eyebrow}</Eyebrow>
            <ChapterTitle lines={[phone.title]} className={t.ink} />
            <p data-reveal="up" style={delay(200)} className={cn("max-w-[28rem] text-[16px] leading-[1.55]", t.muted)}>
              {phone.line}
            </p>
          </header>
        )}
        <header className={cn("flex flex-col gap-5", phone && "max-lg:hidden")}>
          <Eyebrow onPaper={tone === "light"}>{eyebrow}</Eyebrow>
          <ChapterTitle lines={[title]} className={t.ink} />
          <p data-reveal="up" style={delay(200)} className={cn("max-w-[28rem] text-[16px] leading-[1.55]", t.muted)}>
            {line}
          </p>
        </header>
        <div className="grid gap-3">
          {children(play)}
        </div>
      </div>
    </div>
  );
}

export function RewardsBand() {
  return (
    <section id="rewards" aria-label="Rewards" className="grid scroll-mt-16 lg:grid-cols-2 lg:bg-[linear-gradient(to_right,#f3ece6_50%,var(--ground)_50%)]">
      <Half
        side="left"
        tone="dark"
        eyebrow="For the room / Earn"
        title="Show up."
        line="Points come from watching, chatting and calling it. Never from a card."
        phone={{
          eyebrow: "For the room / Rewards",
          title: "Get rewarded for showing up.",
          line: "Watch, chat and call the moment to earn points. Keep your streak, clear the day's quests, climb levels, and cash out: every 1,000 points is $1 in your wallet.",
        }}
      >
        {(play) => (
          <>
            <Streak play={play} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Quests tone="dark" />
              {/* Not on phones (owner, 2026-09-27). */}
              <CallIt tone="dark" play={play} className="max-sm:hidden" />
            </div>
          </>
        )}
      </Half>
      <Half side="right" tone="light" eyebrow="For the room / Grow" title="Level up." line="Climb levels, keep the firsts, and turn points into wallet money when you're ready.">
        {(play) => (
          <>
            <Level />
            <div className="grid gap-3 sm:grid-cols-2">
              <CashOut tone="light" play={play} />
              <Milestones tone="light" />
            </div>
          </>
        )}
      </Half>
    </section>
  );
}
