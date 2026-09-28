"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CellSignalLow,
  HandWaving,
  Lock,
  PencilSimple,
  ShareNetwork,
  Sparkle,
  UserPlus,
  UsersThree,
  X,
  type Icon,
} from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";
import { centsToDollars, giftByEmoji } from "@/lib/gifts";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import type { CoachIcon, CoachLine } from "@/lib/coach";
import { cn } from "@/lib/utils";
import { giftUnit, isShout, nameColor, type ChatLine, type ChatMsg } from "./lines";

/** Lines the lane shows at once. One more is drawn at the top, fading out. */
export const LANE_LINES = 6;

/** One thing in the lane, oldest first. */
export type LaneEntry =
  | { kind: "line"; id: string; at: number; line: Exclude<ChatLine, { kind: "drops" }> }
  | { kind: "join"; id: string; at: number; name: string; others: number };

const COACH_ICON: Record<CoachIcon, Icon> = {
  bell: Bell,
  share: ShareNetwork,
  invite: UserPlus,
  title: PencilSimple,
  signal: CellSignalLow,
  spark: Sparkle,
  lock: Lock,
};

/** Newest first: how much of each line is left as it climbs. The last one is on its way out. */
const FADE = [1, 1, 0.94, 0.8, 0.62, 0.42, 0];

const HINT_KEY = "xtream:studio:lane-hint-seen";
/** The hint counts as seen once it's been up this long. */
const HINT_MS = 12000;

function readHintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function writeHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Storage off: it shows again next time, which is harmless.
  }
}

/**
 * The chat on screen, TikTok Live's way (Greg's practice run, 2026-09-28:
 * "the chat on screen: that's what Greg also wanted"). The latest lines
 * float over the lower left of the picture, newest at the bottom, older
 * ones climbing and fading out. Gifts and arrivals are lines too, and the
 * coach's tips (lib/coach.ts) sit at the foot, marked as the host's own.
 *
 * A name (or the line) opens that person's actions: the same pin, screen,
 * time-out and ban the chat panel has, now with words on them. The first
 * time, a hint says so.
 *
 * Cheap on purpose: a handful of rows in the DOM, flat dark tints (no
 * blur), and motion that is transform and opacity only — rows glide to
 * their new place with a FLIP on the compositor.
 */
export function ChatLane({
  entries,
  coach,
  badgesFor,
  actionable,
  onAct,
  onDismissCoach,
  hidden = false,
  className,
}: {
  /** Oldest first; the last LANE_LINES + 1 are drawn. */
  entries: LaneEntry[];
  /** Host tips, drawn at the foot until they go. */
  coach: CoachLine[];
  badgesFor: (msg: ChatMsg) => ReactNode;
  /** Whether this line has actions for this host. */
  actionable: (entry: LaneEntry & { kind: "line" }) => boolean;
  onAct: (entry: LaneEntry & { kind: "line" }) => void;
  onDismissCoach: (id: string) => void;
  /** Out of sight for now (the full chat is open); kept mounted so it picks up where it was. */
  hidden?: boolean;
  className?: string;
}) {
  const shown = entries.slice(-(LANE_LINES + 1));
  const rowsRef = useRef(new Map<string, HTMLElement>());
  const topsRef = useRef(new Map<string, number>());
  const [hintSeen, setHintSeen] = useState(readHintSeen);
  const anyActionable = shown.some((e) => e.kind === "line" && actionable(e));
  const hintUp = !hintSeen && anyActionable && !hidden;

  const seeHint = () => {
    if (hintSeen) return;
    writeHintSeen();
    setHintSeen(true);
  };

  // One look is enough: the hint goes for good once it has been up a while.
  useEffect(() => {
    if (!hintUp) return;
    const t = setTimeout(() => {
      writeHintSeen();
      setHintSeen(true);
    }, HINT_MS);
    return () => clearTimeout(t);
  }, [hintUp]);

  // FLIP: every row that moved glides from where it was; a new row rises in.
  const signature = [...shown.map((e) => e.id), ...coach.map((c) => c.id), hintUp ? "hint" : ""].join("|");
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    const next = new Map<string, number>();
    rowsRef.current.forEach((el, id) => {
      const top = el.offsetTop;
      next.set(id, top);
      if (reduce) return;
      const prev = topsRef.current.get(id);
      if (prev === undefined) {
        el.animate([{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: Number(getComputedStyle(el).opacity) || 1 }], {
          duration: DURATION.row,
          easing: EASE.unfold,
        });
      } else if (Math.abs(prev - top) > 0.5) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "none" }], { duration: DURATION.row, easing: EASE.unfold });
      }
    });
    topsRef.current = next;
  }, [signature]);

  const hold = (id: string) => (el: HTMLElement | null) => {
    if (el) rowsRef.current.set(id, el);
    else rowsRef.current.delete(id);
  };

  return (
    <div
      data-theme="dark"
      // Out of sight is out of reach too: nothing in it takes a tap or focus.
      inert={hidden}
      // Keep taps here from starting a drag on the room's sheet (a portal bubbles through React).
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        // The top edge dissolves, so a line leaving is a fade, not a cut.
        "pointer-events-none flex max-h-full flex-col justify-end gap-1 overflow-hidden transition-opacity duration-200 [mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]",
        hidden && "opacity-0",
        className,
      )}
    >

      {shown.map((e, i) => {
        const fade = FADE[shown.length - 1 - i] ?? 0;
        const style = { opacity: fade };
        if (e.kind === "join") {
          return (
            <p
              key={e.id}
              ref={hold(e.id)}
              style={style}
              className="flex w-fit max-w-full shrink-0 items-center gap-1.5 rounded-[10px] bg-black/50 px-2 py-1 text-[12.5px] text-white/80 transition-opacity duration-300"
            >
              <HandWaving size={13} weight="fill" className="shrink-0 text-ember-hi" />
              <span className="min-w-0 truncate">
                <span className="font-semibold" style={{ color: nameColor(e.name) }}>
                  {e.name}
                </span>
                {e.others > 0 && ` and ${e.others} other${e.others === 1 ? "" : "s"}`} joined
              </span>
            </p>
          );
        }
        const can = actionable(e);
        const act = can
          ? () => {
              seeHint();
              onAct(e);
            }
          : undefined;
        return (
          <LaneRow key={e.id} entry={e} rowRef={hold(e.id)} style={style} badges={e.line.kind === "stage" ? null : badgesFor(e.line.msg)} onAct={act} />
        );
      })}

      {hintUp && (
        <button
          ref={hold("hint")}
          type="button"
          onClick={seeHint}
          className="press pointer-events-auto flex h-7 w-fit shrink-0 items-center gap-1.5 rounded-full bg-inverse pr-2 pl-3 text-[12px] font-semibold text-on-inverse"
        >
          Tap a name for actions
          <X size={11} weight="bold" aria-hidden />
        </button>
      )}

      {coach.map((c) => {
        const CoachGlyph = COACH_ICON[c.icon] ?? Sparkle;
        return (
          <div
            key={c.id}
            ref={hold(c.id)}
            role="status"
            className="pointer-events-auto flex w-fit max-w-full shrink-0 items-center gap-2 rounded-[10px] bg-black/70 py-1 pr-1 pl-1.5 shadow-[inset_0_0_0_1px_rgb(248_88_16/0.35)]"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ember/[0.18] text-ember-hi">
              <CoachGlyph size={13} weight="fill" />
            </span>
            <p className="min-w-0 text-[12.5px] leading-snug font-medium text-white">
              {c.text}
              <span className="ml-1.5 text-[10.5px] font-semibold tracking-wide whitespace-nowrap text-white/45 uppercase">Only you</span>
            </p>
            {c.action && (
              <Pill size="sm" variant="ember" onClick={c.action.run} className="h-7 shrink-0 px-2.5 whitespace-nowrap">
                {c.action.label}
              </Pill>
            )}
            <button
              type="button"
              onClick={() => onDismissCoach(c.id)}
              aria-label="Dismiss tip"
              className="press flex size-7 shrink-0 items-center justify-center rounded-full text-white/55 hover:text-white"
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** A chat line, a gift or a stage move, as a row on the picture. */
function LaneRow({
  entry,
  rowRef,
  style,
  badges,
  onAct,
}: {
  entry: LaneEntry & { kind: "line" };
  rowRef: (el: HTMLElement | null) => void;
  style: React.CSSProperties;
  badges: ReactNode;
  onAct?: () => void;
}) {
  const { line } = entry;
  const msg = line.msg;
  const name = (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onAct?.();
      }}
      disabled={!onAct}
      aria-label={onAct ? `Actions for ${msg.username}` : undefined}
      className="mr-1.5 font-semibold disabled:cursor-default"
      style={{ color: nameColor(msg.username) }}
    >
      {msg.username}
    </button>
  );

  let body: ReactNode;
  let lead: ReactNode;
  if (line.kind === "stage") {
    lead = <UsersThree size={14} weight="fill" className="mt-[2px] shrink-0 text-ember-hi" />;
    body = (
      <>
        {name}
        <span className="text-white/80">{msg.content}</span>
      </>
    );
  } else if (line.kind === "gift") {
    const def = giftByEmoji(msg.emoji);
    const unit = giftUnit(msg);
    const shout = isShout(msg);
    const what = shout ? null : def?.id === "request" ? msg.content : def ? def.verb : msg.content || "tipped";
    const amount = unit === "usd" ? centsToDollars(line.total) : unit === "pts" ? `+${line.total.toLocaleString()} pts` : `${msg.tipAmount} ${msg.tipCurrency}`;
    lead = <GiftArt emoji={msg.emoji ?? (shout ? "📣" : "🎁")} size={24} className="-my-0.5 shrink-0" />;
    body = (
      <>
        {badges}
        {name}
        {shout ? <span className="font-semibold break-words">{msg.content}</span> : <span className="text-white/85">{what}</span>}
        {line.count > 1 && <span className="ml-1 font-mono font-bold">×{line.count}</span>}
        <span className={cn("ml-1.5 font-bold whitespace-nowrap", unit === "pts" ? "text-ember-hi" : "text-value")}>{amount}</span>
      </>
    );
  } else {
    lead = <UserAvatar src={msg.avatar} name={msg.username} size={20} className="mt-px size-5 shrink-0" />;
    body = (
      <>
        {badges}
        {name}
        <span className={cn("break-words", msg.type === "reaction" && "text-[17px] leading-none")}>{msg.content}</span>
      </>
    );
  }

  return (
    <div
      ref={rowRef}
      style={style}
      onClick={onAct}
      className={cn(
        "flex w-fit max-w-full shrink-0 items-start gap-1.5 rounded-[10px] bg-black/50 px-2 py-[5px] transition-opacity duration-300",
        onAct && "pointer-events-auto cursor-pointer",
      )}
    >
      {lead}
      <p className="min-w-0 text-[13px] leading-snug text-white">{body}</p>
    </div>
  );
}
