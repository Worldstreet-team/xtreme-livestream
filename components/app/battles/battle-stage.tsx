"use client";

import Link from "next/link";
import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { Room } from "livekit-client";
import { ArrowClockwise, Flag, ShareNetwork, SpeakerHigh, SpeakerSlash, Trophy, X } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { shortTeamName } from "@/lib/battle-result";
import {
  barShare,
  captionFor,
  clockFor,
  dimmed,
  leaderKey,
  outcomeOf,
  pushToast,
  resultLine,
  resultUp,
  scoreLine,
  seatsOf,
  shouldAnnounce,
  sidesFor,
  stampShowing,
  toastText,
  TOAST_MS,
  vsShowing,
  type GiftToast,
  type SideKey,
} from "@/lib/battle-stage";
import { formatPoints, giftFilterLine, inMultiplierWindow, isBattleActive, teamName, type BattleSide, type BattleView } from "@/lib/battles";
import { serverOffset } from "@/lib/server-clock";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill } from "@/components/ui/pill";
import { BattleResultSheet } from "@/components/app/battle-result-card";
import { useClashFeed, type ClashHit } from "@/components/app/battles/use-clash-feed";
import styles from "./battle-stage.module.css";

/**
 * The battle stage, TikTok LIVE Match's grammar in Afterglow: a score bar
 * over the two feeds (our side Chili on the left, theirs a lighter Ember on
 * the right, white points inside each end, a white-hot seam that eases to
 * the new share), the clock in a pill hung on the seam, and over the feeds
 * the win streaks, each side's three top supporters, the other side's name
 * and speaker, gift toasts, and — once it's settled — WIN and LOSE stamped
 * on the halves, the loser dimmed for the victory lap and the forfeit card.
 *
 * It draws no video. The surface keeps rendering the feeds with
 * SceneRenderer (it owns the host's <video> and the 2v2 cell order) in a
 * band, and this overlay lines up with the same band through CSS custom
 * properties set on an ancestor:
 *   --bar-top   where the bar starts        --bar-h    its height
 *   --band-top  where the feeds start       --band-h   their height
 *   --band-left their left edge (0)         --band-w   their width (100%)
 *
 * Everything is data-driven from the server's view (and the server's
 * clock), so the bar, the clock and the seats stay live when a feed
 * stalls. Nothing here decides a result or sends room data.
 */

/** The two sides' colours: ours is the Chili, theirs the lighter Ember. */
const OURS = "var(--chili)";
const THEIRS = "var(--ember-hi)";
/** White numbers on the lighter Ember need a little ink under them to stay readable. */
const INKED: CSSProperties = { textShadow: "0 1px 2px rgb(0 0 0 / 0.55), 0 0 1px rgb(0 0 0 / 0.6)" };

const V = {
  barTop: "var(--bar-top, 0px)",
  barH: "var(--bar-h, 16px)",
  bandTop: "var(--band-top, 16px)",
  bandH: "var(--band-h, 50%)",
  bandLeft: "var(--band-left, 0px)",
  bandW: "var(--band-w, 100%)",
};

export interface BattleStageProps {
  battle: BattleView;
  /** The room this stage is drawn in: its side is ours, on the left. */
  streamId: string;
  /**
   * "phone": the lap's forfeit card and actions sit under the band, where
   * the chat starts. "inset": inside the band, over the feeds' lower half
   * (a computer's player, the studio).
   */
  layout?: "phone" | "inset";
  /** The host's own stage (the studio): End battle, and after the result Rematch and End lap. */
  host?: boolean;
  /** Is the other side's sound on? (Off by default everywhere.) */
  hear: boolean;
  onHear: (hear: boolean) => void;
  /** Open the result card somewhere that outlives the stage; unset, the stage opens its own. */
  onShare?: (battle: BattleView) => void;
  /** A host action came back with the battle as it now is — hand it to the surface before the fan-out lands. */
  onBattle?: (battle: BattleView) => void;
  /** Gift toasts while it runs; off where nobody's watching (radio). */
  toasts?: boolean;
  /**
   * The room the stage is drawn in, while connected: its server-sent
   * `battle` packets carry each counted gift, so the toasts need no poll
   * (just a slow backstop). Unset, they poll the battle's activity feed.
   */
  room?: Room | null;
  /** More for the activity feed's query ("?previewKey=…"): a practice run's preview link. */
  feedQuery?: string;
  className?: string;
}

export function BattleStage({
  battle,
  streamId,
  layout = "phone",
  host = false,
  hear,
  onHear,
  onShare,
  onBattle,
  toasts = true,
  feedQuery = "",
  room = null,
  className,
}: BattleStageProps) {
  const now = useNow(true) + serverOffset();
  const { ours, theirs } = sidesFor(battle, streamId);
  const active = isBattleActive(battle);
  const ended = battle.status === "ended";
  const up = ended && resultUp(battle, now);
  const pair = battle.mode === "2v2";
  const practice = Boolean(battle.practice);
  const share = barShare(battle, ours);
  const clock = clockFor(battle, now);
  const doubled = active && inMultiplierWindow(battle, now);
  const caption = captionFor(battle, now, giftFilterLine(battle.giftFilter));
  const stamped = stampShowing(battle, now);
  const lap = up && Boolean(battle.winnerId);
  const loser: SideKey | null = ended ? (outcomeOf(battle, "host") === "lose" ? "host" : outcomeOf(battle, "challenger") === "lose" ? "challenger" : null) : null;

  // The side that just scored flashes once: a counter per side, bumped when its score goes up.
  const [seen, setSeen] = useState({ id: battle.id, host: battle.host.usdMinor, challenger: battle.challenger.usdMinor, flash: { host: 0, challenger: 0 } });
  if (seen.id !== battle.id || seen.host !== battle.host.usdMinor || seen.challenger !== battle.challenger.usdMinor) {
    const fresh = seen.id !== battle.id;
    setSeen({
      id: battle.id,
      host: battle.host.usdMinor,
      challenger: battle.challenger.usdMinor,
      flash: {
        host: seen.flash.host + (!fresh && battle.host.usdMinor > seen.host ? 1 : 0),
        challenger: seen.flash.challenger + (!fresh && battle.challenger.usdMinor > seen.challenger ? 1 : 0),
      },
    });
  }

  // A late gift just reset the clock: "+15s" flies into the pill, once.
  const [reset, setReset] = useState({ id: battle.id, used: Boolean(battle.lateResetUsed), until: 0 });
  if (reset.id !== battle.id || reset.used !== Boolean(battle.lateResetUsed)) {
    const flipped = reset.id === battle.id && !reset.used && Boolean(battle.lateResetUsed);
    setReset({ id: battle.id, used: Boolean(battle.lateResetUsed), until: flipped ? now + 1_800 : 0 });
  }
  const resetFlying = active && now < reset.until;

  // Screen readers: the score now and then (every ten seconds at most, at
  // once on a lead change), and the result the moment it's settled.
  const line = scoreLine(battle, ours);
  const lead = leaderKey(battle);
  const [said, setSaid] = useState<{ at: number; lead: SideKey | null; line: string } | null>(null);
  if (active && shouldAnnounce(said, lead, line, now)) setSaid({ at: now, lead, line });
  const [told, setTold] = useState<string | null>(null);
  if (ended && told !== battle.id) setTold(battle.id);

  // Gift toasts: the gifts that counted, pushed over the room (or, outside one, polled).
  const [toastList, setToastList] = useState<GiftToast[]>([]);
  const onHits = useCallback((hits: ClashHit[]) => {
    const at = Date.now();
    setToastList((list) =>
      hits.reduce(
        (acc, h) => (h.gift ? pushToast(acc, { key: h.key, side: h.side, sender: h.gift.sender, gift: h.gift.name, emoji: h.gift.emoji }, at) : acc),
        list,
      ),
    );
  }, []);
  useClashFeed(battle, toasts && active, onHits, feedQuery, room);
  const clientNow = now - serverOffset();
  const shownToasts = toastList.filter((t) => clientNow - t.at < TOAST_MS);

  // The result card: the surface's, or our own.
  const [sharing, setSharing] = useState<BattleView | null>(null);
  const openShare = () => (onShare ? onShare(battle) : setSharing(battle));

  const column = (side: SideKey) => {
    const s = battle[side];
    const isOurs = side === ours;
    const outcome = outcomeOf(battle, side);
    const color = isOurs ? OURS : THEIRS;
    const outer = isOurs ? "left" : "right";
    return (
      <div key={side} className="relative min-w-0 overflow-hidden">
        {/* The loser, dimmed for the lap — a plain shade, never a blur. */}
        <div aria-hidden className={cn("absolute inset-0 bg-black/35", styles.fade, dimmed(battle, side, now) ? "opacity-100" : "opacity-0")} />

        {/* WIN ×N in the outer top corner. */}
        {Boolean(s.streak) && (
          <span
            key={`streak-${s.streak}`}
            className={cn(
              "obj absolute top-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 font-wide text-[10px] font-bold tracking-[0.02em] text-white",
              outer === "left" ? "left-1.5" : "right-1.5",
              ended && outcome === "win" && styles.bump,
            )}
            title={`${teamName(s)}: ${s.streak} win${s.streak === 1 ? "" : "s"} in a row`}
          >
            WIN <span className="font-mono tabular-nums text-ember-hi">×{s.streak}</span>
          </span>
        )}

        {/* Gifts this side just got, dropping in under the corner. */}
        <div className={cn("absolute top-14 flex max-w-[calc(100%-12px)] flex-col gap-1", outer === "left" ? "left-1.5 items-start" : "right-1.5 items-end")} aria-hidden>
          {shownToasts
            .filter((t) => t.side === side)
            .map((t) => (
              <span key={`${t.key}-${t.count}`} className={cn("obj flex max-w-full items-center gap-1 rounded-full py-0.5 pr-2 pl-1 text-[10.5px] font-semibold text-white", styles.toast)}>
                <span className="shrink-0 text-[13px] leading-none">{t.emoji || "🎁"}</span>
                <span className="truncate">{toastText(t)}</span>
              </span>
            ))}
        </div>

        {/* WIN / LOSE, stamped on the half. A draw gets one stamp over the seam instead. */}
        {stamped && outcome && outcome !== "draw" && (
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="-rotate-[8deg]">
              <span
                className={cn(
                  "block rounded-[10px] px-3.5 py-1 font-wide text-[clamp(22px,7cqw,40px)] leading-none font-black tracking-[-0.02em] italic",
                  outcome === "win" ? "bg-white text-[#0b0708]" : "bg-black/70 text-white/85",
                  styles.stamp,
                )}
              >
                {outcome === "win" ? "WIN" : "LOSE"}
              </span>
            </span>
          </div>
        )}

        {/* Along the bottom: their name and the speaker (theirs), the team's tag (a pair), then the seats. */}
        <div className={cn("absolute inset-x-1.5 bottom-1.5 flex flex-col gap-1", outer === "left" ? "items-start" : "items-end")}>
          {!isOurs ? (
            <OpponentTag side={s} practice={practice} pair={pair} hear={hear} onHear={onHear} />
          ) : pair ? (
            <span className="obj max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold text-white">{shortTeamName(s)}</span>
          ) : null}
          <Seats side={s} color={color} reverse={outer === "right"} />
        </div>
      </div>
    );
  };

  const drawStamp = stamped && ended && !battle.winnerId;
  const forfeitCard = lap && loser && battle.forfeit && (
    <div className="obj min-w-0 flex-1 rounded-[12px] px-3 py-2 text-white">
      <p className="line-clamp-2 text-[12.5px] leading-snug font-semibold">
        <span className="text-ember-hi">{teamName(battle[loser])}:</span> {battle.forfeit}
      </p>
      <p className="text-[11px] text-white/60">They can decline it</p>
    </div>
  );
  const lapActions = up && (
    <LapActions battle={battle} host={host} onShare={openShare} onBattle={onBattle} practice={practice} theirName={teamName(battle[theirs])} />
  );

  return (
    <div className={cn("pointer-events-none absolute inset-0 z-[25] [container-type:inline-size]", className)} data-battle-stage>
      {/* ---- The score bar ---- */}
      <div
        className="absolute overflow-hidden"
        style={{ top: V.barTop, left: V.bandLeft, width: V.bandW, height: V.barH, background: THEIRS }}
        role="img"
        aria-label={line}
      >
        <div className={cn("absolute inset-y-0 left-0", styles.fill)} style={{ width: `${share * 100}%`, background: OURS }}>
          <span key={`f${seen.flash[ours]}`} className={cn("absolute inset-0 bg-white opacity-0", seen.flash[ours] > 0 && styles.flash)} />
        </div>
        <span key={`t${seen.flash[theirs]}`} className={cn("absolute inset-y-0 right-0 bg-white opacity-0", seen.flash[theirs] > 0 && styles.flash)} style={{ width: `${(1 - share) * 100}%` }} />
        <span className="absolute inset-y-0 left-2 flex items-center font-mono text-[11px] leading-none font-bold text-white tabular-nums" style={INKED}>
          {formatPoints(battle[ours].usdMinor)}
        </span>
        <span className="absolute inset-y-0 right-2 flex items-center font-mono text-[11px] leading-none font-bold text-white tabular-nums" style={INKED}>
          {formatPoints(battle[theirs].usdMinor)}
        </span>
        {/* The seam: where the two sides meet, white-hot. */}
        <span className={cn("absolute -top-px -bottom-px w-[3px] -translate-x-1/2 rounded-full bg-white", styles.seam)} style={{ left: `${share * 100}%` }} />
      </div>

      {/* ---- The feeds' overlays, in the band ---- */}
      <div className="absolute grid grid-cols-2" style={{ top: V.bandTop, left: V.bandLeft, width: V.bandW, height: V.bandH }}>
        {column(ours)}
        {column(theirs)}

        {drawStamp && (
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="-rotate-[8deg]">
              <span className={cn("block rounded-[10px] bg-white px-4 py-1 font-wide text-[clamp(24px,8cqw,44px)] leading-none font-black tracking-[-0.02em] text-[#0b0708] italic", styles.stamp)}>
                DRAW
              </span>
            </span>
          </div>
        )}
        {vsShowing(battle, now) && (
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className={cn("font-wide text-[clamp(30px,11cqw,64px)] leading-none font-black tracking-[-0.04em] text-white italic [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]", styles.stamp)}>
              VS
            </span>
          </div>
        )}

        {/* In "inset", the lap's card and actions sit over the feeds, just above the names and seats. */}
        {layout === "inset" && up && (
          <div className="pointer-events-auto absolute inset-x-3 bottom-[68px] flex flex-col items-center gap-1.5">
            {forfeitCard && <div className="flex w-full max-w-[420px]">{forfeitCard}</div>}
            {lapActions}
          </div>
        )}
      </div>

      {/* ---- The clock, hung on the seam ---- */}
      <div className="absolute flex -translate-x-1/2 items-start gap-1.5" style={{ top: V.bandTop, left: `calc(${V.bandLeft} + ${V.bandW} / 2)` }}>
        {host && active && <span className="size-7 shrink-0" aria-hidden />}
        <div className="relative flex flex-col items-center gap-1">
          <span
            key={clock.tone === "final" ? `beat-${clock.left}` : "clock"}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full px-2.5 font-mono text-[12.5px] leading-none font-bold tabular-nums",
              clock.tone === "double" ? "bg-ember text-on-ember" : clock.tone === "final" ? "bg-chili text-white" : clock.tone === "lap" ? "bg-black/75 text-white" : "bg-black/70 text-white",
              clock.tone === "final" && styles.beat,
            )}
            aria-hidden
          >
            {clock.tone === "lap" && <Trophy size={12} weight="fill" className="text-white" />}
            {clock.overtime && <span className="font-wide text-[10px] tracking-[0.04em]">OT</span>}
            {clock.tone === "lap" ? <span className="font-wide text-[10px] tracking-[0.04em]">LAP</span> : null}
            <span className={cn(clock.tone === "draw" && "font-wide text-[11px] tracking-[0.02em]")}>{clock.text}</span>
            {doubled && <span className={cn("rounded-full px-1 font-wide text-[10px]", clock.tone === "final" ? "bg-white/20" : "bg-on-ember/15")}>×{battle.multiplier}</span>}
          </span>
          {resetFlying && (
            <span key={`reset-${reset.until}`} className={cn("absolute top-0 left-1/2 rounded-full bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#0b0708] tabular-nums", styles.fly)}>
              +15s
            </span>
          )}
          {caption && (
            <span
              className={cn(
                "max-w-[min(78vw,340px)] truncate rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                caption.tone === "double" ? "bg-black/70 text-ember-hi" : "bg-black/55 text-white/85",
              )}
            >
              {caption.text}
            </span>
          )}
        </div>
        {host && active && <EndBattle battle={battle} onBattle={onBattle} />}
      </div>

      {/* On a phone, the lap's card and actions sit under the feeds, where the chat starts. */}
      {layout === "phone" && up && (forfeitCard || lapActions) && (
        <div className="pointer-events-auto absolute inset-x-3 flex items-center gap-2" style={{ top: `calc(${V.bandTop} + ${V.bandH} + 8px)` }}>
          {forfeitCard}
          <div className={cn("flex shrink-0 items-center gap-1.5", !forfeitCard && "w-full justify-center")}>{lapActions}</div>
        </div>
      )}

      {/* What a screen reader hears: the score now and then, the result at once. */}
      <p className="sr-only" aria-live="polite">
        {active && said ? said.line : ""}
      </p>
      <p className="sr-only" aria-live="assertive">
        {ended && told === battle.id ? resultLine(battle) : ""}
      </p>

      {sharing && <BattleResultSheet battle={sharing} streamId={streamId} onClose={() => setSharing(null)} />}
    </div>
  );
}

/** A side's three seats: its top supporters, ranked, in the side's colour; an empty seat is a faint circle. */
function Seats({ side, color, reverse }: { side: BattleSide; color: string; reverse: boolean }) {
  const seats = seatsOf(side);
  const names = seats.filter(Boolean).map((s) => s!.displayName);
  return (
    <div
      className={cn("flex items-center gap-1", reverse && "flex-row-reverse")}
      role="img"
      aria-label={names.length ? `${teamName(side)}'s top supporters: ${names.join(", ")}` : `${teamName(side)}: no supporters yet`}
    >
      {seats.map((s, i) => (
        <span key={i} className="relative flex size-[26px] shrink-0 items-center justify-center">
          {s ? (
            <span key={s.userId} className={cn("relative flex rounded-full", styles.pop)} title={s.displayName}>
              <UserAvatar src={s.avatar} name={s.displayName} size={24} className="size-6 text-[9px]" />
              <span className="absolute -inset-[2px] rounded-full border-2" style={{ borderColor: color }} aria-hidden />
            </span>
          ) : (
            <span className="size-6 rounded-full border border-dashed border-white/30 bg-black/20" aria-hidden />
          )}
          <span
            className={cn(
              "absolute -bottom-1 left-1/2 flex h-3 min-w-3 -translate-x-1/2 items-center justify-center rounded-full px-[3px] font-mono text-[8px] leading-none font-bold",
              s ? "bg-white text-[#0b0708]" : "bg-black/50 text-white/50",
            )}
            aria-hidden
          >
            {i + 1}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The other side, named on their half: a tap goes to their room; the speaker turns them up or down. */
function OpponentTag({ side, practice, pair, hear, onHear }: { side: BattleSide; practice: boolean; pair: boolean; hear: boolean; onHear: (v: boolean) => void }) {
  const name = pair ? shortTeamName(side) : side.displayName;
  const label = (
    <span className="block max-w-full truncate text-[11.5px] font-semibold text-white">{name}</span>
  );
  return (
    <div className="pointer-events-auto flex max-w-full items-center gap-1">
      {practice ? (
        <span className="obj min-w-0 rounded-full px-2 py-0.5">{label}</span>
      ) : (
        <Link href={`/stream/${side.streamId}`} className="obj press min-w-0 rounded-full px-2 py-0.5 hover:bg-black/70" title={`Go to ${name}'s room`}>
          {label}
        </Link>
      )}
      {!practice && (
        <button
          type="button"
          onClick={() => onHear(!hear)}
          aria-pressed={hear}
          aria-label={hear ? `Mute ${name}'s side` : `Hear ${name}'s side`}
          title={hear ? "Mute their side" : "Hear their side"}
          className={cn("press flex size-6 shrink-0 items-center justify-center rounded-full", hear ? "obj-on" : "obj text-white")}
        >
          {hear ? <SpeakerHigh size={13} weight="fill" /> : <SpeakerSlash size={13} weight="fill" />}
        </button>
      )}
    </div>
  );
}

async function post(path: string) {
  const r = await apiFetch<{ success: boolean; data: { battle: BattleView } }>(path, { method: "POST" });
  return r.data.battle;
}

/**
 * The host's way out of a running battle: conceding counts as a loss, so
 * it asks first. A practice battle just ends (cancel), as it always has.
 */
function EndBattle({ battle, onBattle }: { battle: BattleView; onBattle?: (b: BattleView) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await post(`/api/battles/${battle.id}/${battle.practice ? "cancel" : "concede"}`);
      setAsking(false);
      onBattle?.(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't end the battle");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setAsking((v) => !v)}
        aria-expanded={asking}
        aria-label="End battle"
        title="End battle"
        className={cn("press flex size-7 items-center justify-center rounded-full", asking ? "obj-on" : "obj text-white")}
      >
        <Flag size={14} weight="fill" />
      </button>
      {asking && (
        <div role="dialog" aria-label="End the battle?" className="absolute top-9 right-0 z-10 w-[220px] rounded-[12px] bg-[#0b0708]/95 p-3 text-white shadow-lg">
          <p className="text-[13px] font-semibold">{battle.practice ? "End the practice battle?" : "End the battle now?"}</p>
          <p className="mt-0.5 text-[12px] text-white/65">{battle.practice ? "Nothing is counted — it's practice." : "Ending now counts as a loss."}</p>
          {error && <p className="mt-1.5 text-[11.5px] text-chili-hi">{error}</p>}
          <div className="mt-2.5 flex gap-1.5">
            <Pill size="sm" variant="live" onClick={() => void end()} disabled={busy}>
              End battle
            </Pill>
            <Pill size="sm" variant="glass" onClick={() => setAsking(false)} icon={<X size={12} />}>
              Keep going
            </Pill>
          </div>
        </div>
      )}
    </div>
  );
}

/** After the result: Share for everyone; for the host, Rematch and End lap too. */
function LapActions({
  battle,
  host,
  practice,
  theirName,
  onShare,
  onBattle,
}: {
  battle: BattleView;
  host: boolean;
  practice: boolean;
  theirName: string;
  onShare: () => void;
  onBattle?: (b: BattleView) => void;
}) {
  const [busy, setBusy] = useState<"rematch" | "lap" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = async (what: "rematch" | "lap") => {
    setBusy(what);
    setNote(null);
    try {
      const b = await post(`/api/battles/${battle.id}/${what === "rematch" ? "rematch" : "end-lap"}`);
      if (what === "rematch" && !practice) setNote(`Rematch asked — waiting for ${theirName}`);
      // A rematch is a new invite (they still accept): this battle keeps the stage till its lap ends.
      // A practice rematch starts at once.
      if (what === "lap" || practice) onBattle?.(b);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };
  const buttons: ReactNode[] = [];
  if (host) {
    buttons.push(
      <Pill key="rematch" size="sm" variant="ember" icon={<ArrowClockwise size={13} weight="bold" />} onClick={() => void act("rematch")} disabled={busy !== null || Boolean(note?.startsWith("Rematch"))}>
        Rematch
      </Pill>,
      <Pill key="lap" size="sm" variant="glass" onClick={() => void act("lap")} disabled={busy !== null}>
        {battle.winnerId ? "End lap" : "Done"}
      </Pill>,
    );
  }
  buttons.push(
    <Pill key="share" size="sm" variant={host ? "glass" : "primary"} icon={<ShareNetwork size={13} weight="fill" />} onClick={onShare} aria-label={practice ? "See the result" : "Share result"}>
      {host ? "Share" : practice ? "See the result" : "Share result"}
    </Pill>,
  );
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5">{buttons}</div>
      {note && <p className="obj rounded-full px-2 py-0.5 text-[11px] font-semibold text-white">{note}</p>}
    </div>
  );
}
