"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Room } from "livekit-client";
import { Lightning, Play, X } from "@/components/icons";
import {
  formatClock,
  formatCountdown,
  formatPracticeScore,
  giftFilterLine,
  inMultiplierWindow,
  isBattleActive,
  leaderOf,
  secondsLeft,
  teamName,
  type BattleGift,
  type BattleView,
} from "@/lib/battles";
import { giftArtUrl, giftByEmoji } from "@/lib/gifts";
import { DURATION, EASE, MOTION_VARS, prefersReducedMotion } from "@/lib/motion";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { Pill, PillLink } from "@/components/ui/pill";
import { PracticeBadge } from "@/components/app/practice-preview";
import { GiftArt } from "@/components/app/gift-art";
import { formatUsd } from "@/components/xtream/money";
import { BattleField } from "./battle-field";
import { ClashEmblem, type EmblemScene } from "./clash-emblem";
import { TickDigits } from "./tick-digits";
import { POLL_MS, useClashFeed, type ClashHit, type ClashSide } from "./use-clash-feed";
import s from "./battles.module.css";

/**
 * The clash view: what opens when you tap a battle card.
 *
 * - Computers: a window that unfolds out of the card. It starts as the
 *   card — scaled to its width, clipped to its height, sitting on it — and
 *   opens out to its own size in the middle of the screen; closing folds
 *   it back onto the card, quicker.
 * - Phones: a sheet rising from the foot. Pull it down (from its top) to
 *   let it go.
 *
 * Inside, the battle plays out in real time (see ./use-clash-feed.ts for
 * where hits come from — real gifts, or the score's own movement, never
 * made up):
 * - the two sides face off, the faces slamming in from the edges and the
 *   emblem stamping down between them (VS; crossed blades on a big hit or
 *   a lead change; the winner's crown; a clock for a booked battle);
 * - each hit flies in from its side's edge — the gift's art on an arc into
 *   the face, sparks in the side's colour into the meter's knot — and
 *   lands: the face bumps, a ring spreads, the side flashes its colour,
 *   the meter shakes and is yanked toward that side, the score counts up
 *   and "+$5" floats off it;
 * - the ×2 window flares; lead changes are called ("Ladi takes the
 *   lead"); top backers per side; for a 2v2, the pairs;
 * - one clear way in: Watch the battle.
 *
 * A practice battle (a practice run against the sparring partner) plays
 * out the same, with its scores as practice points rather than money, a
 * Practice badge, and no way into a room — there's no other side to watch.
 *
 * Performance: transform, opacity and clip-path only. Flights run on the
 * Web Animations API over a fixed pool of elements (no React per frame),
 * capped, and a hit that finds the pool empty sends fewer sparks. Reduced
 * motion: no flights, no shake — the numbers change with a fade.
 */

const PHONE_MAX = 767;
/** Elements kept for flights; a busy moment sends fewer sparks rather than more nodes. */
const POOL = 30;
const FLOATS = 6;
/** Pull the sheet down past this, or flick it, and it goes. */
const DISMISS_PX = 110;
const DISMISS_V = 0.6;

type Mode = "desk" | "phone";
type ShellState = "measure" | "enter" | "open" | "closing";

export function ClashView({
  battle,
  from,
  open,
  triggerRef,
  onClose,
  onGone,
  feedQuery = "",
  room = null,
}: {
  battle: BattleView | null;
  /** The card's rect when it was tapped: the window unfolds out of it. */
  from: DOMRect | null;
  open: boolean;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** After the exit has played out. */
  onGone?: () => void;
  /** More for the feed's query ("?previewKey=…"), for a practice run's preview link. */
  feedQuery?: string;
  /** The room this battle is pushed to, when the surface is in it: no polling then. */
  room?: Room | null;
}) {
  const [present, setPresent] = useState(false);
  const [state, setState] = useState<ShellState>("measure");
  const [mode, setMode] = useState<Mode>("desk");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const onGoneRef = useRef(onGone);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    onGoneRef.current = onGone;
  });

  // Opening and closing are reconciled during render.
  if (open && battle && (!present || state === "closing")) {
    const phone = window.innerWidth <= PHONE_MAX;
    setPresent(true);
    setMode(phone ? "phone" : "desk");
    setState(phone ? "enter" : "measure");
  }
  if (!open && present && state !== "closing") setState("closing");

  // Computers: measure where the window lands, then start it on the card.
  useLayoutEffect(() => {
    if (!present || state !== "measure") return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const r = panel.getBoundingClientRect();
    if (from && r.width > 0) {
      const k = from.width / r.width;
      root.style.setProperty("--fx", `${from.left - r.left}px`);
      root.style.setProperty("--fy", `${from.top - r.top}px`);
      root.style.setProperty("--fs", String(k));
      root.style.setProperty("--fclip", `${Math.max(0, r.height - from.height / k)}px`);
      root.style.setProperty("--fr", `${10 / k}px`);
    }
    // Start a beat later: the content mounts (and its pictures decode) while
    // the window is still hidden, so the unfold's fast first frames aren't
    // spent waiting on that work.
    const t = setTimeout(() => setState("open"), 34);
    return () => clearTimeout(t);
  }, [present, state, from]);

  // Phones: the closed transform paints first, then the sheet rises.
  useEffect(() => {
    if (!present || state !== "enter") return;
    const t = setTimeout(() => setState("open"), 20);
    return () => clearTimeout(t);
  }, [present, state]);

  // The exit plays out, then it's gone.
  useEffect(() => {
    if (state !== "closing") return;
    const ms = prefersReducedMotion() ? DURATION.fade : mode === "phone" ? 260 : 240;
    const t = setTimeout(() => {
      setPresent(false);
      setState("measure");
      onGoneRef.current?.();
    }, ms + 30);
    return () => clearTimeout(t);
  }, [state, mode]);

  // Focus in, Escape out, focus back to the card; the page holds still.
  useEffect(() => {
    if (!open || !present) return;
    const trigger = triggerRef?.current;
    const t = setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      trigger?.focus({ preventScroll: true });
    };
  }, [open, present, triggerRef]);

  // Phones: pull the sheet down from its top to dismiss.
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number; x: number; axis: "x" | "y" | null } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "phone" || e.pointerType === "mouse") return;
    // Only from the top of the sheet, or from anywhere when the body is scrolled to its top.
    const body = panelRef.current?.querySelector<HTMLElement>("[data-scroll]");
    const inBody = body?.contains(e.target as Node);
    if (inBody && body && body.scrollTop > 0) return;
    start.current = { y: e.clientY, x: e.clientX, t: performance.now(), axis: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    const dy = e.clientY - st.y;
    const dx = e.clientX - st.x;
    if (!st.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      st.axis = dy > 0 && Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      if (st.axis === "y") {
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    }
    if (st.axis === "y") setDrag(Math.max(0, dy));
  };
  const endDrag = (e: React.PointerEvent) => {
    const st = start.current;
    start.current = null;
    if (!st || st.axis !== "y") return;
    const dy = Math.max(0, e.clientY - st.y);
    const v = dy / Math.max(1, performance.now() - st.t);
    setDragging(false);
    setDrag(0);
    if (dy > DISMISS_PX || v > DISMISS_V) onCloseRef.current();
  };

  if (!present || !battle || typeof document === "undefined") return null;

  const label = `${teamName(battle.host)} versus ${teamName(battle.challenger)}`;
  const content = <Clash initial={battle} phone={mode === "phone"} active={state === "open"} onClose={onClose} feedQuery={feedQuery} room={room} />;

  return createPortal(
    <div
      ref={rootRef}
      data-glass-popover
      className={s.root}
      data-mode={mode}
      data-state={state}
      data-dragging={dragging || undefined}
      style={{ ...MOTION_VARS, ["--drag" as string]: `${drag}px` } as CSSProperties}
    >
      <div className={s.scrim} onClick={onClose} aria-hidden />
      {mode === "phone" ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={cn(s.sheet, "pb-[env(safe-area-inset-bottom)]")}
          // A booked battle has little to show: the sheet fits it rather than standing tall and empty.
          data-fit={battle.status === "scheduled" || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className={s.grab} aria-hidden />
          {content}
        </div>
      ) : (
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={s.deskPanel}>
          {content}
        </div>
      )}
    </div>,
    document.body,
  );
}

/* ======================================================================
   The battle, playing out
   ====================================================================== */

type FeedRow = { key: string; side: ClashSide; usdMinor: number; gift?: { name: string; emoji: string; sender: string }; fresh: boolean };
type Callout = { key: number | string; side: ClashSide | "none"; text: string; stay: boolean };

const both = ["host", "challenger"] as const;
const shareOf = (v: { host: number; challenger: number }) => (v.host + v.challenger === 0 ? 0.5 : v.host / (v.host + v.challenger));
const pct = (x: number) => `${Math.round(x * 100)}%`;

function restScene(b: BattleView): EmblemScene {
  if (b.status === "scheduled" || b.status === "invited") return "clock";
  if (b.status === "ended" && b.winnerId) return b.winnerId === b.host.userId ? "crown-host" : "crown-challenger";
  return "vs";
}

function Clash({
  initial,
  phone,
  active,
  onClose,
  feedQuery,
  room,
}: {
  initial: BattleView;
  phone: boolean;
  active: boolean;
  onClose: () => void;
  feedQuery: string;
  room: Room | null;
}) {
  const now = useNow(true);
  // A practice battle's scores are points, never money: written plainly, not in the money face.
  const practice = Boolean(initial.practice);
  const fmt = practice ? formatPracticeScore : formatUsd;
  const moneyFace = practice ? "font-mono font-bold text-foreground" : "font-money text-value";
  const reduced = useRef(false);
  const [play, setPlay] = useState<"idle" | "go">("idle");
  const [burst, setBurst] = useState(false);
  const [lead, setLead] = useState(() => leaderOf(initial.host.usdMinor, initial.challenger.usdMinor));
  const [callout, setCallout] = useState<Callout | null>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [initialShare] = useState(() => shareOf({ host: initial.host.usdMinor, challenger: initial.challenger.usdMinor }));
  // The ground's seam follows the same split as the meter (a render per hit, not per frame).
  const [fieldShare, setFieldShare] = useState(initialShare);

  const stageRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const knotRef = useRef<HTMLSpanElement>(null);
  const bump = { host: useRef<HTMLDivElement>(null), challenger: useRef<HTMLDivElement>(null) };
  const ring = { host: useRef<HTMLSpanElement>(null), challenger: useRef<HTMLSpanElement>(null) };
  const score = { host: useRef<HTMLSpanElement>(null), challenger: useRef<HTMLSpanElement>(null) };
  const pctRef = { host: useRef<HTMLSpanElement>(null), challenger: useRef<HTMLSpanElement>(null) };

  const shown = useRef({ host: initial.host.usdMinor, challenger: initial.challenger.usdMinor });
  const pending = useRef(0);
  const timers = useRef(new Set<number>());
  const tweens = useRef<{ host: number; challenger: number }>({ host: 0, challenger: 0 });
  const pool = useRef<FlightPool | null>(null);
  const names = useRef({ host: initial.host.displayName, challenger: initial.challenger.displayName });
  const serverRef = useRef(initial);
  const callKey = useRef(0);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  // Set up: numbers written by hand from here on (they count, React doesn't re-render per frame).
  useLayoutEffect(() => {
    reduced.current = prefersReducedMotion();
    for (const side of both) {
      if (score[side].current) score[side].current.textContent = fmt(shown.current[side]);
    }
    writeShare();
    if (layerRef.current) pool.current = new FlightPool(layerRef.current, POOL, FLOATS, practice);
    const ts = timers.current;
    const tw = tweens.current;
    return () => {
      ts.forEach((t) => clearTimeout(t));
      ts.clear();
      cancelAnimationFrame(tw.host);
      cancelAnimationFrame(tw.challenger);
      pool.current?.destroy();
      pool.current = null;
    };
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The entrance plays once the window is open (and stays played while it folds away)…
  if (active && play === "idle") setPlay("go");
  // …and the emblem clashes as the faces meet.
  useEffect(() => {
    if (play !== "go" || reduced.current || !isBattleActive(initial)) return;
    later(() => setBurst(true), 420);
    later(() => setBurst(false), 1150);
  }, [play, initial, later]);

  function writeShare() {
    const x = shareOf(shown.current);
    barRef.current?.style.setProperty("--share", String(x));
    if (pctRef.host.current) pctRef.host.current.textContent = pct(x);
    if (pctRef.challenger.current) pctRef.challenger.current.textContent = pct(1 - x);
  }

  function countTo(side: ClashSide, from: number, to: number) {
    const el = score[side].current;
    if (!el) return;
    cancelAnimationFrame(tweens.current[side]);
    if (reduced.current) {
      el.textContent = fmt(to);
      el.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: DURATION.fade });
      return;
    }
    const t0 = performance.now();
    const dur = 620;
    const ease = easeOut;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      // Whole dollars while it counts (cents flicker), the exact amount when it lands.
      el.textContent = fmt(k < 1 ? Math.round((from + (to - from) * ease(k)) / 100) * 100 : to);
      if (k < 1) tweens.current[side] = requestAnimationFrame(step);
    };
    tweens.current[side] = requestAnimationFrame(step);
  }

  function call(side: ClashSide | "none", text: string, stay = false) {
    callKey.current += 1;
    const key = callKey.current;
    setCallout({ key, side, text, stay });
    if (!stay) later(() => setCallout((c) => (c?.key === key ? null : c)), 2250);
  }

  function bigHit(usd: number) {
    const total = shown.current.host + shown.current.challenger;
    return usd >= Math.max(2500, total * 0.12);
  }

  /** A hit arrives: everything on its side reacts at once. */
  function land(hit: ClashHit) {
    const before = { ...shown.current };
    shown.current = { ...before, [hit.side]: before[hit.side] + hit.usdMinor };
    countTo(hit.side, before[hit.side], shown.current[hit.side]);
    writeShare();
    setFieldShare(shareOf(shown.current));
    const size = Math.min(1, Math.log10(1 + hit.usdMinor / 100) / 2.5);

    if (!reduced.current) {
      bump[hit.side].current?.animate(
        [{ transform: "scale(1)" }, { transform: `scale(${1.06 + size * 0.08})`, offset: 0.3 }, { transform: "scale(1)" }],
        { duration: DURATION.impact, easing: EASE.clash },
      );
      ring[hit.side].current?.animate([{ transform: "scale(0.9)", opacity: 0.95 }, { transform: `scale(${1.4 + size * 0.5})`, opacity: 0 }], {
        duration: 480,
        easing: EASE.unfold,
      });
      // The side's ground flashes its colour and surges at the seam.
      const arena = arenaRef.current;
      arena
        ?.querySelector(`[data-field-flash="${hit.side}"]`)
        ?.animate([{ opacity: 0 }, { opacity: 0.14 + size * 0.14, offset: 0.18 }, { opacity: 0 }], { duration: 520, easing: "linear" });
      const push = (hit.side === "host" ? 1 : -1) * (4 + size * 8);
      arena
        ?.querySelector(`[data-field-surge="${hit.side}"]`)
        ?.animate([{ transform: "none" }, { transform: `translateX(${push}px)`, offset: 0.3 }, { transform: "none" }], { duration: 420, easing: EASE.clash });
      const amp = 3 + size * 5;
      const dir = hit.side === "host" ? 1 : -1;
      meterRef.current?.animate(
        [
          { transform: "none" },
          { transform: `translateX(${dir * amp}px)`, offset: 0.18 },
          { transform: `translateX(${-dir * amp * 0.6}px)`, offset: 0.45 },
          { transform: `translateX(${dir * amp * 0.3}px)`, offset: 0.7 },
          { transform: "none" },
        ],
        { duration: DURATION.impact, easing: "linear" },
      );
      knotRef.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.45)", offset: 0.3 }, { transform: "scale(1)" }], {
        duration: 300,
        easing: EASE.clash,
      });
      const at = score[hit.side].current?.getBoundingClientRect();
      if (at) pool.current?.float(`+${fmt(hit.usdMinor, true)}`, at, hit.side);
    }

    setFeed((f) => [{ key: hit.key, side: hit.side, usdMinor: hit.usdMinor, gift: hit.gift, fresh: true }, ...f.map((r) => ({ ...r, fresh: false }))].slice(0, 5));

    const was = leaderOf(before.host, before.challenger);
    const is = leaderOf(shown.current.host, shown.current.challenger);
    if (is && is !== was) {
      setLead(is);
      call(is, before.host + before.challenger === 0 ? `${names.current[is]} strikes first` : `${names.current[is]} takes the lead`);
      clash();
    } else if (bigHit(hit.usdMinor)) {
      clash();
    }
  }

  function clash() {
    if (reduced.current) return;
    setBurst(true);
    later(() => setBurst(false), 720);
  }

  /** A hit sets off: the gift arcs in from its side's edge, sparks chase it into the meter. */
  function launch(hit: ClashHit) {
    const layer = layerRef.current;
    const faceEl = bump[hit.side].current;
    const knot = knotRef.current;
    if (reduced.current || !layer || !faceEl || !knot || !pool.current) {
      land(hit);
      return;
    }
    const box = layer.getBoundingClientRect();
    const f = faceEl.getBoundingClientRect();
    const k = knot.getBoundingClientRect();
    const dir = hit.side === "host" ? 1 : -1;
    const x0 = hit.side === "host" ? -36 : box.width + 36;
    const fx = f.left + f.width / 2 - box.left;
    const fy = f.top + f.height / 2 - box.top;
    const kx = k.left + k.width / 2 - box.left;
    const ky = k.top + k.height / 2 - box.top;
    const flight = DURATION.flight;
    const y0 = box.height * (0.18 + Math.random() * 0.45);

    const art = hit.gift ? giftByEmoji(hit.gift.emoji)?.art : undefined;
    const lead = pool.current.fly({
      x0,
      y0,
      x1: fx + (Math.random() - 0.5) * 14,
      y1: fy + (Math.random() - 0.5) * 10,
      lift: 40 + Math.random() * 30,
      delay: 0,
      dur: flight,
      kind: hit.gift ? "gift" : "spark",
      side: hit.side,
      src: art ? giftArtUrl(art) : undefined,
      text: hit.gift && !art ? hit.gift.emoji || "🎁" : undefined,
      size: hit.gift ? 44 : 16,
      spin: hit.gift ? dir * 14 : dir * 200,
    });
    // Sparks: more for a bigger hit, fewer when the pool is busy.
    const n = Math.max(3, Math.min(8, Math.round(Math.log2(1 + hit.usdMinor / 100)) + 2));
    for (let i = 0; i < n; i++) {
      pool.current.fly({
        x0,
        y0: y0 + (Math.random() - 0.5) * 60,
        x1: kx + dir * -(6 + Math.random() * 26),
        y1: ky + (Math.random() - 0.5) * 10,
        lift: 10 + Math.random() * 50,
        delay: 50 + i * 38,
        dur: flight * (0.82 + Math.random() * 0.2),
        kind: "spark",
        side: hit.side,
        size: 7 + Math.random() * 5,
        spin: dir * (120 + Math.random() * 180),
      });
    }
    pending.current += 1;
    later(() => {
      pending.current -= 1;
      land(hit);
      settleIfIdle();
    }, lead ? flight : 0);
  }

  /** With nothing in flight, the numbers match the server's exactly. */
  function settleIfIdle() {
    if (pending.current > 0) return;
    const server = serverRef.current;
    for (const side of both) {
      const want = server[side].usdMinor;
      if (want !== shown.current[side]) {
        const was = shown.current[side];
        shown.current = { ...shown.current, [side]: want };
        countTo(side, was, want);
      }
    }
    writeShare();
    setLead(leaderOf(shown.current.host, shown.current.challenger));
    setFieldShare(shareOf(shown.current));
  }

  const { battle, history } = useClashFeed(
    initial,
    active,
    (hits, next) => {
      serverRef.current = next;
      names.current = { host: next.host.displayName, challenger: next.challenger.displayName };
      if (hits.length === 0) {
        settleIfIdle();
        return;
      }
      // Spread a poll's hits across the gap to the next, so they land as a stream.
      const gap = Math.min(420, (POLL_MS - 500) / hits.length);
      hits.forEach((h, i) => later(() => launch(h), i * gap));
    },
    feedQuery,
    room,
  );

  // The ending, and the start of a booked one, are called out and stay.
  const status = battle?.status ?? initial.status;
  const [calledFor, setCalledFor] = useState(initial.status);
  if (status !== calledFor) {
    setCalledFor(status);
    if (battle && (status === "live" || status === "ended" || status === "cancelled")) {
      const w = battle.winnerId ? (battle.winnerId === battle.host.userId ? "host" : "challenger") : null;
      setCallout({
        key: `status-${status}`,
        side: status === "live" ? "none" : (w ?? "none"),
        text: status === "live" ? "The battle is on" : status === "cancelled" ? "Battle called off" : w ? `${teamName(battle[w])} wins` : "It's a draw",
        stay: status !== "live",
      });
    }
  }

  const b = battle ?? initial;
  const live = isBattleActive(b);
  const booked = b.status === "scheduled" || b.status === "invited";
  const ended = b.status === "ended" || b.status === "cancelled";
  const hot = live && inMultiplierWindow(b, now);
  const scene: EmblemScene = burst ? "clash" : restScene(b);
  const filter = giftFilterLine(b.giftFilter);
  const startsMs = b.scheduledAt ? new Date(b.scheduledAt).getTime() - now : 0;
  const winner = b.winnerId ? (b.winnerId === b.host.userId ? b.host : b.challenger) : null;

  const history_: FeedRow[] = history.map((g: BattleGift) => ({
    key: `h${g.id}`,
    side: g.side,
    usdMinor: g.usdMinor,
    gift: { name: g.giftName, emoji: g.emoji, sender: g.sender.displayName },
    fresh: false,
  }));
  const rows = [...feed, ...history_.filter((h) => !feed.some((f) => f.key === `g${h.key.slice(1)}`))].slice(0, 5);

  const side = (which: ClashSide) => {
    const v = b[which];
    const tone = which === "host" ? "ring-chili" : "ring-ember";
    const big = phone ? 72 : 88;
    return (
      <div className={s.side} data-side={which}>
        <div className={s.enter}>
          <div ref={bump[which]} className={s.bump}>
            <UserAvatar src={v.avatar} name={v.displayName} size={big} className={cn("ring-[3px] ring-offset-[3px] ring-offset-popover", tone)} />
            {v.partner && (
              <span className={cn("absolute -bottom-1", which === "host" ? "-right-3" : "-left-3")}>
                <UserAvatar src={v.partner.avatar} name={v.partner.displayName} size={phone ? 32 : 38} className="ring-[3px] ring-popover" />
              </span>
            )}
            <span ref={ring[which]} className={s.ring} aria-hidden />
          </div>
        </div>
        <div className={cn(s.names, "mt-3 w-full min-w-0")}>
          <p className="truncate text-[14.5px] font-semibold text-foreground sm:text-[15.5px]">{teamName(v)}</p>
          {booked ? (
            <p className="truncate text-[12.5px] text-muted-foreground">@{v.username}</p>
          ) : (
            <p className={cn("mt-0.5 text-[22px] leading-none tracking-[-0.01em] text-foreground tabular-nums sm:text-[26px]", practice ? "font-mono font-bold" : "font-money")}>
              <span ref={score[which]} />
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ ["--lead" as string]: phone ? "200ms" : "240ms" } as CSSProperties}>
      {/* The top line: what this is, the clock, the way out. */}
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {/* A practice run isn't on air: Practice where LIVE would be, as on its preview. */}
          {practice && <PracticeBadge size="sm" />}
          {live ? (
            practice ? <Badge variant="muted">Battle</Badge> : <LiveBadge>{" · Battle"}</LiveBadge>
          ) : booked ? (
            <Badge variant="muted">Booked battle</Badge>
          ) : (
            <Badge variant="muted">{b.status === "cancelled" ? "Called off" : "Final"}</Badge>
          )}
          {b.mode === "2v2" && <Badge variant="muted">2v2 · pairs</Badge>}
        </div>
        <span
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[14px] font-bold tabular-nums",
            hot ? "bg-ember text-on-ember" : live ? "bg-inverse text-on-inverse" : "bg-control text-foreground/85",
          )}
          aria-live="off"
        >
          {live ? (
            <>
              {hot && <Lightning size={12} weight="fill" />}
              {b.status === "overtime" && <span>OT</span>}
              <TickDigits text={formatClock(secondsLeft(b, now))} />
              <span className="sr-only">{formatClock(secondsLeft(b, now))} left</span>
            </>
          ) : booked ? (
            <>
              <span className="font-sans text-[12px] font-semibold">Starts in</span>
              <TickDigits text={formatCountdown(startsMs)} />
            </>
          ) : (
            <span className="font-sans text-[12px] font-semibold">Final</span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-control text-foreground transition-colors hover:bg-control-hover"
        >
          <X size={17} weight="bold" />
        </button>
      </div>

      {/* The arena and its meter share one stage, so flights can cross from
          one to the other. It never scrolls: the show stays in view while
          the lists under it move. */}
      <div ref={stageRef} className={cn(s.stage, "relative shrink-0")} data-play={play}>
        <div
          ref={arenaRef}
          className={cn(s.arena, "grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-4 pt-6 pb-5 sm:px-6 sm:pt-7")}
        >
          <BattleField id={b.id} share={fieldShare} lead={live ? lead : null} tone={live ? "live" : booked ? "booked" : "ended"} hot={hot} wide={!phone} />

          {side("host")}
          <div className={cn(s.emblem, "relative z-[7] flex flex-col items-center")} style={{ marginTop: phone ? 2 : 4 }}>
            <ClashEmblem scene={scene} className={phone ? "size-[76px]" : "size-[96px]"} />
          </div>
          {side("challenger")}

          {callout && (
            <div
              key={callout.key}
              className={cn(
                s.callout,
                "flex h-11 items-center justify-center px-4 font-wide text-[17px] font-black tracking-[-0.02em] italic sm:h-12 sm:text-[19px]",
                callout.side === "host" ? "bg-chili text-white" : callout.side === "challenger" ? "bg-ember text-on-ember" : "bg-inverse text-on-inverse",
              )}
              data-side={callout.side}
              data-stay={callout.stay || undefined}
              role="status"
            >
              <span className="truncate">{callout.text}</span>
            </div>
          )}
        </div>

        {/* The tug of war, heavy. */}
        <div className="px-4 pt-1 pb-4 sm:px-6">
          <div ref={meterRef}>
            <div className={s.meterIn}>
              <div ref={barRef} className={s.meter} style={{ ["--share" as string]: initialShare } as CSSProperties} aria-hidden>
                <span className={s.tugHost} />
                <span className={s.knotTrack}>
                  <span ref={knotRef} className={s.knot} />
                </span>
              </div>
            </div>
          </div>
          {!booked && (
            <div className={cn(s.row, "mt-2 flex items-center justify-between font-mono text-[11.5px] font-bold tabular-nums")} style={{ ["--i" as string]: 0 } as CSSProperties}>
              <span className="text-chili-hi" ref={pctRef.host} />
              <span className="font-sans text-[11.5px] font-medium text-muted-foreground">
                {ended ? (winner ? `${teamName(winner)} took it` : "Level at the bell") : "Gifts pull the line"}
              </span>
              <span className="text-ember-hi" ref={pctRef.challenger} />
            </div>
          )}
        </div>

        <div ref={layerRef} className={s.particles} aria-hidden />
      </div>

      <div data-scroll className={cn(s.stage, "min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none [overflow-anchor:none]")} data-play={play}>

        {/* The ×2 window flares. */}
        {hot && (
          <div className="px-4 pb-4 sm:px-6">
            <div className={cn(s.flare, "flex h-10 items-center justify-center gap-2 rounded-[10px] bg-ember text-[13.5px] font-bold text-on-ember")}>
              <Lightning size={15} weight="fill" />
              Every gift counts ×{b.multiplier} · {formatClock(secondsLeft(b, now))} left
            </div>
          </div>
        )}

        {booked && (
          <div className={cn(s.row, "px-4 pb-4 sm:px-6")} style={{ ["--i" as string]: 1 } as CSSProperties}>
            <div className="rounded-[10px] bg-control px-4 py-3.5">
              <p className="text-[14px] font-semibold text-foreground">
                {b.scheduledAt ? `Starts ${new Date(b.scheduledAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "Starts soon"}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                It starts by itself when both are live{b.mode === "2v2" ? ", with a partner on each stage" : ""}. {Math.round(b.durationSec / 60)} minutes on the clock; gifts count ×{b.multiplier} in the last {b.multiplierWindowSec} s.
              </p>
            </div>
          </div>
        )}

        {/* What's happening, as it happens. */}
        {!booked && (
          <section className={cn(s.row, "px-4 pb-4 sm:px-6")} style={{ ["--i" as string]: 1 } as CSSProperties}>
            <h3 className="mb-2 text-[12px] font-semibold tracking-[0.02em] text-muted-foreground uppercase">Live activity</h3>
            {rows.length === 0 ? (
              <p className="rounded-[10px] bg-control px-3.5 py-3 text-[13px] text-muted-foreground">
                {live ? "Waiting for the next gift. Every one pulls the line." : "No gifts landed in this one."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li
                    key={r.key}
                    className={cn(s.feedRow, "flex h-11 items-center gap-2.5 rounded-[10px] bg-control px-3")}
                    data-side={r.side}
                    data-new={r.fresh || undefined}
                  >
                    <span className={cn("h-5 w-1 shrink-0 rounded-full", r.side === "host" ? "bg-chili" : "bg-ember")} aria-hidden />
                    {r.gift ? (
                      <GiftArt emoji={r.gift.emoji} size={24} />
                    ) : (
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", r.side === "host" ? "bg-chili/15 text-chili-hi" : "bg-ember/15 text-ember-hi")}>
                        <Lightning size={13} weight="fill" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
                      {r.gift ? (
                        <>
                          <span className="font-semibold">{r.gift.sender}</span>
                          <span className="text-muted-foreground"> sent {r.gift.name || "a gift"} for </span>
                          {teamName(b[r.side])}
                        </>
                      ) : (
                        <>
                          <span className="text-muted-foreground">Gifts for </span>
                          <span className="font-semibold">{teamName(b[r.side])}</span>
                        </>
                      )}
                    </span>
                    <span className={cn("shrink-0 text-[14px] tabular-nums", moneyFace)}>+{fmt(r.usdMinor, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Who's carrying each side. */}
        {!booked && (
          <section className={cn(s.row, "px-4 pb-4 sm:px-6")} style={{ ["--i" as string]: 2 } as CSSProperties}>
            <h3 className="mb-2 text-[12px] font-semibold tracking-[0.02em] text-muted-foreground uppercase">Top backers</h3>
            <div className="grid grid-cols-2 gap-2">
              {both.map((which) => {
                const top = b[which].top ?? [];
                return (
                  <div key={which} className="min-w-0 rounded-[10px] bg-control p-2.5">
                    <p className="mb-1.5 flex items-center gap-1.5 truncate text-[12px] font-semibold text-foreground">
                      <span className={cn("size-2 shrink-0 rounded-full", which === "host" ? "bg-chili" : "bg-ember")} aria-hidden />
                      <span className="truncate">{teamName(b[which])}</span>
                    </p>
                    {top.length === 0 ? (
                      <p className="py-1 text-[12.5px] text-muted-foreground">No backers yet</p>
                    ) : (
                      <ol className="space-y-1">
                        {top.map((t, i) => (
                          <li key={t.userId} className="flex items-center gap-2">
                            <span className="w-3 shrink-0 text-center font-mono text-[11px] font-bold text-muted-foreground">{i + 1}</span>
                            <UserAvatar src={t.avatar} name={t.displayName} size={22} className="size-[22px]" />
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{t.displayName}</span>
                            <span className={cn("shrink-0 text-[12.5px] tabular-nums", moneyFace)}>{fmt(t.usdMinor, true)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {(filter || b.forfeit) && (
          <div className={cn(s.row, "flex flex-wrap gap-1.5 px-4 pb-4 sm:px-6")} style={{ ["--i" as string]: 3 } as CSSProperties}>
            {filter && <Badge variant="muted">{filter}</Badge>}
            {b.forfeit && <Badge variant="muted">Loser: {b.forfeit}</Badge>}
          </div>
        )}
      </div>

      {/* One clear way in. */}
      <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-4 shadow-[inset_0_1px_0_var(--hairline-color)] sm:flex-row sm:items-center sm:px-5">
        {practice ? (
          // Nobody's room to go to: the sparring partner is a stand-in.
          <>
            <Pill variant="primary" size="lg" className="w-full sm:w-auto" onClick={onClose}>
              Back to the practice run
            </Pill>
            <p className="text-[12.5px] leading-snug text-muted-foreground">Practice points from simulated gifts. Nobody sees this and no money moves.</p>
          </>
        ) : booked ? (
          <>
            <PillLink href={`/c/${b.host.username}`} variant="primary" size="lg" className="w-full sm:w-auto" onClick={onClose}>
              Visit {b.host.displayName}
            </PillLink>
            <PillLink href={`/c/${b.challenger.username}`} variant="ghost" size="md" className="w-full sm:w-auto" onClick={onClose}>
              {b.challenger.displayName}&apos;s channel
            </PillLink>
          </>
        ) : (
          <>
            <PillLink
              href={`/stream/${(winner ?? b.host).streamId}`}
              variant="live"
              size="lg"
              icon={<Play size={16} weight="fill" />}
              className="w-full sm:w-auto"
              onClick={onClose}
            >
              {live ? "Watch the battle" : `Go to ${(winner ?? b.host).displayName}`}
            </PillLink>
            {live && (
              <PillLink href={`/stream/${b.challenger.streamId}`} variant="ghost" size="md" className="w-full sm:w-auto" onClick={onClose}>
                Or join {b.challenger.displayName}&apos;s room
              </PillLink>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/* ======================================================================
   Flights: a fixed pool of elements, moved by the Web Animations API
   ====================================================================== */

type Flight = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** How far above the straight line the arc peaks. */
  lift: number;
  delay: number;
  dur: number;
  kind: "gift" | "spark";
  side: ClashSide;
  src?: string;
  text?: string;
  size: number;
  spin: number;
};

type Node3 = { x: HTMLDivElement; y: HTMLDivElement; body: HTMLDivElement; img: HTMLImageElement; label: HTMLSpanElement };

class FlightPool {
  private free: Node3[] = [];
  private floats: HTMLSpanElement[] = [];
  private floatAt = 0;
  private readonly all: Node3[] = [];
  private live = new Set<Animation>();

  constructor(
    private readonly layer: HTMLDivElement,
    size: number,
    floats: number,
    /** A practice battle's "+500 pts" floats aren't money. */
    practice = false,
  ) {
    for (let i = 0; i < size; i++) {
      // Three layers: across (x), the arc (y), and the thing itself (scale, spin, fade).
      const x = document.createElement("div");
      const y = document.createElement("div");
      const body = document.createElement("div");
      const img = document.createElement("img");
      const label = document.createElement("span");
      x.className = s.p!;
      y.className = s.p!;
      body.className = s.pIn!;
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      label.style.lineHeight = "1";
      x.style.opacity = "0";
      y.appendChild(body);
      x.appendChild(y);
      layer.appendChild(x);
      const n = { x, y, body, img, label };
      this.all.push(n);
      this.free.push(n);
    }
    for (let i = 0; i < floats; i++) {
      const f = document.createElement("span");
      f.className = cn(s.float, "text-[15px] font-semibold tabular-nums", practice ? "font-mono text-foreground" : "font-money text-value");
      layer.appendChild(f);
      this.floats.push(f);
    }
  }

  destroy() {
    this.live.forEach((a) => a.cancel());
    this.live.clear();
    this.layer.replaceChildren();
  }

  /** Send one thing flying; false if the pool is empty (the caller sends fewer). */
  fly(f: Flight): boolean {
    const n = this.free.pop();
    if (!n) return false;
    const { x, y, body, img, label } = n;
    body.className = s.pIn!;
    body.removeAttribute("data-side");
    body.style.width = body.style.height = `${f.size}px`;
    body.style.marginLeft = body.style.marginTop = `${-f.size / 2}px`;
    body.replaceChildren();
    if (f.kind === "gift") {
      if (f.src) {
        img.src = f.src;
        img.width = img.height = f.size;
        img.style.width = img.style.height = `${f.size}px`;
        body.appendChild(img);
      } else {
        label.textContent = f.text ?? "🎁";
        label.style.fontSize = `${f.size * 0.8}px`;
        body.appendChild(label);
      }
    } else {
      body.className = cn(s.pIn, s.spark);
      body.dataset.side = f.side;
    }
    x.style.opacity = "1";

    const peak = Math.min(f.y0, f.y1) - f.lift;
    const opts = { duration: f.dur, delay: f.delay, fill: "both" as const };
    const ax = x.animate([{ transform: `translateX(${f.x0}px)` }, { transform: `translateX(${f.x1}px)` }], { ...opts, easing: "cubic-bezier(0.32, 0.1, 0.24, 1)" });
    const ay = y.animate(
      [
        { transform: `translateY(${f.y0}px)`, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
        { transform: `translateY(${peak}px)`, offset: 0.4, easing: "cubic-bezier(0.6, 0, 0.9, 0.55)" },
        { transform: `translateY(${f.y1}px)` },
      ],
      { ...opts, easing: "linear" },
    );
    const end = f.kind === "gift" ? 0.7 : 0.4;
    const ab = body.animate(
      [
        { opacity: 0, transform: "scale(0.5) rotate(0deg)" },
        { opacity: 1, offset: 0.14 },
        { transform: `scale(${f.kind === "gift" ? 1.2 : 1}) rotate(${f.spin * 0.6}deg)`, offset: 0.6 },
        { opacity: 1, transform: `scale(${end}) rotate(${f.spin}deg)`, offset: 0.94 },
        { opacity: 0, transform: `scale(${end * 0.6}) rotate(${f.spin}deg)` },
      ],
      { ...opts, easing: "linear" },
    );
    const anims = [ax, ay, ab];
    anims.forEach((a) => this.live.add(a));
    ab.onfinish = () => {
      anims.forEach((a) => {
        this.live.delete(a);
        a.cancel();
      });
      x.style.opacity = "0";
      this.free.push(n);
    };
    return true;
  }

  /** "+$5" (or "+500 pts") rising off a score. */
  float(text: string, at: DOMRect, side: ClashSide) {
    const f = this.floats[this.floatAt++ % this.floats.length];
    if (!f) return;
    const box = this.layer.getBoundingClientRect();
    f.textContent = text;
    const x = at.left - box.left + at.width / 2;
    const y = at.top - box.top - 6;
    const drift = side === "host" ? -8 : 8;
    f.getAnimations().forEach((a) => a.cancel());
    const a = f.animate(
      [
        { opacity: 0, transform: `translate(${x}px, ${y}px) translate(-50%, 0) scale(0.8)` },
        { opacity: 1, transform: `translate(${x}px, ${y - 12}px) translate(-50%, 0) scale(1)`, offset: 0.25 },
        { opacity: 1, offset: 0.7 },
        { opacity: 0, transform: `translate(${x + drift}px, ${y - 34}px) translate(-50%, 0) scale(1)` },
      ],
      { duration: 1000, easing: EASE.unfold },
    );
    this.live.add(a);
    a.onfinish = () => this.live.delete(a);
  }
}
