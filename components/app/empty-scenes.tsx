"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ArtCanvas,
  Badge,
  Bar,
  Bell,
  Bubble,
  Card,
  Clock,
  Coin,
  Dot,
  Enter,
  Figure,
  Gift,
  Ground,
  Idle,
  Lens,
  Phone,
  Pulse,
  Shield,
  Star,
  Ticket,
  motion,
  offset,
  paint,
} from "@/components/app/art/primitives";

/**
 * Xtream's own empty-state illustrations, composed from the art kit
 * (components/app/art). Each stands on the kit's disc, carries at most one
 * accent (Chili when the empty is about being live, Ember for a booked show,
 * gold for money) and has one entrance and one slow idle — still under
 * prefers-reduced-motion, paused off screen.
 */

export type EmptyScene =
  | "live"
  | "messages"
  | "notifications"
  | "search"
  | "allies"
  | "scheduled"
  | "wallet"
  | "points"
  | "broadcasts"
  | "offline"
  | "cleared"
  | "locked"
  | "missing"
  | "sponsors";

/** The catalogue, for the design-system page and anyone choosing a scene. */
export const EMPTY_SCENES: { id: EmptyScene; label: string; use: string }[] = [
  { id: "live", label: "No one live", use: "Explore, the feed, a quiet category" },
  { id: "messages", label: "No messages", use: "The inbox, an empty filter" },
  { id: "notifications", label: "No notifications", use: "The bell" },
  { id: "search", label: "No results", use: "Search and filters that match nothing" },
  { id: "allies", label: "No follows yet", use: "Following, Allies" },
  { id: "scheduled", label: "Nothing scheduled", use: "Upcoming, a channel's calendar" },
  { id: "wallet", label: "No gifts or money yet", use: "Wallet gifts and payouts" },
  { id: "points", label: "No points yet", use: "Wallet points" },
  { id: "broadcasts", label: "No broadcasts yet", use: "Past broadcasts, replays" },
  { id: "offline", label: "Couldn't connect", use: "Errors and dropped connections" },
  { id: "cleared", label: "All clear", use: "A work queue with nothing left" },
  { id: "locked", label: "Not for you", use: "Admin-only, crew-only, removed" },
  { id: "missing", label: "Not found", use: "A stream or channel that isn't there" },
  { id: "sponsors", label: "No deals yet", use: "Campaigns, sponsors, vouchers" },
];

/** Nobody live: a phone waiting to go on air, its tally sending a slow signal. */
function Live() {
  return (
    <Enter>
      <Idle kind="float">
        <Phone x={90} y={24}>
          <rect className={paint.soft} style={{ strokeWidth: 1.5 }} x={98} y={42} width={28} height={11} rx={5.5} />
          <Dot cx={104} cy={47.5} r={2.5} paint="live" className={motion.blink} />
          <Bar x={109} y={46} w={12} h={3} />
          <Pulse cx={120} cy={86} r={14} />
          <Pulse cx={120} cy={86} r={22} offset={1.8} far />
          <Dot cx={120} cy={86} r={5} paint="live" />
          <Bar x={98} y={118} w={30} h={5} />
          <Bar x={98} y={127} w={20} h={5} />
          <circle className={paint.soft} cx={140} cy={129} r={5} />
        </Phone>
      </Idle>
    </Enter>
  );
}

/** No messages: someone's typing, and your reply slides in. */
function Messages() {
  return (
    <>
      <Enter>
        <circle className={paint.card2} cx={46} cy={84} r={10} />
      </Enter>
      <Enter delay={80}>
        <Bubble x={62} y={58} w={86} h={36} typing />
      </Enter>
      <Enter kind="fromRight" delay={280}>
        <Idle kind="float" offset={1}>
          <Bubble x={98} y={104} w={94} mine />
        </Idle>
      </Enter>
    </>
  );
}

/** No notifications: a bell that rings now and then, a dot waiting to mean something. */
function Notifications() {
  return (
    <>
      <Enter delay={180}>
        <Card x={76} y={128} w={88} h={22} r={11} paint="card2" />
        <Dot cx={88} cy={139} r={5} paint="bar" />
        <Bar x={98} y={137} w={46} h={4} />
      </Enter>
      <Enter>
        <Bell cx={120} top={36}>
          <Enter kind="pop" delay={420}>
            <Idle kind="breathe">
              <Dot cx={141} cy={55} r={7} paint="hi" />
            </Idle>
          </Enter>
        </Bell>
      </Enter>
    </>
  );
}

/** No results: empty slots, and a lens that looks around and finds nothing. */
function Search() {
  return (
    <>
      {[0, 1, 2].map((k) => (
        <Enter key={k} delay={k * 70}>
          <Card x={48} y={44 + k * 30} w={112} h={22} r={9} paint="soft" dashed />
          <Card x={56} y={49 + k * 30} w={12} h={12} r={4} paint="bar" />
          <Bar x={74} y={53 + k * 30} w={k === 1 ? 36 : 50} h={4} />
        </Enter>
      ))}
      <Enter kind="pop" delay={260}>
        <Idle kind="seek">
          <Lens cx={160} cy={100} />
        </Idle>
      </Enter>
    </>
  );
}

/** No follows: two people, and the empty seat between them waiting for a third. */
function Allies() {
  return (
    <>
      <Enter>
        <Idle kind="float">
          <Figure cx={66} cy={100} r={18} />
          <Bar x={54} y={126} w={24} h={4} />
        </Idle>
      </Enter>
      <Enter delay={120}>
        <Idle kind="float" offset={1.6}>
          <Figure cx={174} cy={100} r={18} />
          <Bar x={162} y={126} w={24} h={4} />
        </Idle>
      </Enter>
      <Enter kind="pop" delay={260}>
        <Dot cx={120} cy={82} r={21} paint="bar" />
        <circle className={cn(paint.line, paint.dash, motion.spin)} cx={120} cy={82} r={28} />
        <path className={paint.inkLine} style={{ strokeWidth: 2.5 }} d="M120 74v16M112 82h16" />
      </Enter>
      <Enter kind="fade" delay={360}>
        <Bar x={106} y={122} w={28} h={4} />
      </Enter>
    </>
  );
}

/** Nothing scheduled: a week with one day circled, and a clock that keeps going. */
function Scheduled() {
  const cols = [76, 94, 112, 130, 148];
  const rows = [82, 102, 122];
  return (
    <>
      <Enter>
        <Card x={56} y={40} w={112} h={100} />
        <path className={paint.soft} d="M57 64h110" />
        <Card x={80} y={33} w={6} h={14} r={3} paint="card2" />
        <Card x={138} y={33} w={6} h={14} r={3} paint="card2" />
        <Bar x={68} y={50} w={34} h={5} />
        {rows.map((y) => cols.map((x) => (x === 130 && y === 102 ? null : <Dot key={`${x}-${y}`} cx={x} cy={y} r={3} paint="bar" />)))}
      </Enter>
      <Enter kind="pop" delay={420}>
        <Idle kind="breathe">
          <circle className={paint.emberLine} cx={130} cy={102} r={10} />
        </Idle>
        <Dot cx={130} cy={102} r={4} paint="ember" />
      </Enter>
      <Enter kind="pop" delay={260}>
        <Clock cx={172} cy={128} />
      </Enter>
    </>
  );
}

/** No gifts or money yet: a wrapped gift that peeks, and coins turning over. */
function Wallet() {
  return (
    <>
      <Enter kind="pop" delay={460}>
        <Idle kind="float" offset={1.4}>
          <Idle kind="flip" offset={2.2}>
            <Coin cx={56} cy={80} r={10} />
          </Idle>
        </Idle>
      </Enter>
      <Enter>
        <Gift x={72} y={74} peek />
      </Enter>
      <Enter kind="pop" delay={320}>
        <Idle kind="float">
          <Idle kind="flip">
            <Coin cx={174} cy={62} r={15} />
          </Idle>
        </Idle>
      </Enter>
    </>
  );
}

/** No points yet: a badge with points rising out of it, one after another. */
function Points() {
  return (
    <>
      <Enter>
        <path className={paint.card2} d="M106 118l-9 26 11-4 7 8 6-24z" />
        <path className={paint.card2} d="M134 118l9 26-11-4-7 8-6-24z" />
        <circle className={paint.card} cx={120} cy={98} r={30} />
        <circle className={paint.soft} cx={120} cy={98} r={21} />
        <Star cx={120} cy={98} R={12} r={5.2} />
      </Enter>
      {[
        { x: 84, y: 50, t: 0 },
        { x: 132, y: 40, t: 1.4 },
        { x: 156, y: 62, t: 2.8 },
      ].map((p) => (
        <Enter key={p.t} kind="fade" delay={400}>
          <Idle kind="earn" offset={p.t}>
            <Card x={p.x} y={p.y} w={24} h={12} r={6} paint="card2" />
            <path className={paint.inkLine} d={`M${p.x + 8} ${p.y + 6}h8M${p.x + 12} ${p.y + 2}v8`} />
          </Idle>
        </Enter>
      ))}
    </>
  );
}

/** No broadcasts yet: a stack of replays with nothing recorded on them. */
function Broadcasts() {
  return (
    <>
      <Enter>
        <g transform="rotate(-8 112 80)">
          <Idle kind="fanL">
            <Card x={62} y={48} w={100} h={64} r={11} paint="card2" />
          </Idle>
        </g>
      </Enter>
      <Enter delay={60}>
        <g transform="rotate(7 128 82)">
          <Idle kind="fanR">
            <Card x={78} y={50} w={100} h={64} r={11} paint="card2" />
          </Idle>
        </g>
      </Enter>
      <Enter delay={140}>
        <Idle kind="float">
          <Card x={68} y={62} w={104} h={66} r={11} />
          <Dot cx={81} cy={74} r={3.2} paint="live" className={motion.blink} />
          <Bar x={88} y={72.5} w={22} h={3} />
          <path className={cn(paint.ink, paint.inkLine)} style={{ fill: "var(--art-ink)", strokeWidth: 3 }} d="M114 84l15 10-15 10z" />
          <Bar x={80} y={114} w={80} h={3.5} />
          <Bar x={80} y={114} w={24} h={3.5} paint="ink" />
        </Idle>
      </Enter>
    </>
  );
}

/** Couldn't connect: the signal looks for a way through, and the far bar is broken. */
function Offline() {
  const arc = { strokeWidth: 5 };
  return (
    <>
      <Enter>
        <path className={paint.line} style={{ ...arc, strokeDasharray: "7 10" }} d="M83.2 81.2a52 52 0 0 1 73.5 0" />
        <path className={cn(paint.line, motion.search)} style={{ ...arc, ...offset(0.3) }} d="M94.5 92.5a36 36 0 0 1 50.9 0" />
        <path className={cn(paint.line, motion.search)} style={arc} d="M105.9 103.9a20 20 0 0 1 28.3 0" />
        <Dot cx={120} cy={118} r={5.5} />
      </Enter>
      <Enter kind="pop" delay={380}>
        <Idle kind="breathe">
          <Badge cx={162} cy={124} r={13} glyph="alert" />
        </Idle>
      </Enter>
    </>
  );
}

/** All clear: the queue's last card, checked off. */
function Cleared() {
  return (
    <Idle kind="float">
      <Enter>
        <Card x={74} y={44} w={92} h={60} r={11} paint="card2" />
      </Enter>
      <Enter delay={100}>
        <Card x={58} y={58} w={124} h={74} />
        <Dot cx={78} cy={80} r={8} paint="bar" />
        <Bar x={92} y={75} w={46} />
        <Bar x={92} y={84.5} w={30} />
        <Bar x={70} y={104} w={64} />
        <Bar x={70} y={114} w={40} />
      </Enter>
      <Enter kind="pop" delay={420}>
        <Idle kind="breathe">
          <Badge cx={172} cy={126} r={16} glyph="check" />
        </Idle>
      </Enter>
    </Idle>
  );
}

/** Not for you: a shield with a keyhole, two specks keeping watch around it. */
function Locked() {
  return (
    <>
      <Enter kind="fade" delay={200}>
        <Idle kind="spin">
          <Dot cx={120} cy={20} r={3} paint="speck" />
          <Dot cx={120} cy={160} r={3} paint="speck" />
        </Idle>
      </Enter>
      <Enter>
        <Idle kind="float">
          <Shield cx={120} top={34} />
        </Idle>
      </Enter>
    </>
  );
}

/** Not found: the frame where it should be, and a name tag drifting out of reach. */
function Missing() {
  return (
    <>
      <Enter>
        <Card x={52} y={44} w={136} h={88} paint="line" dashed />
      </Enter>
      <Enter kind="pop" delay={240}>
        <Idle kind="wander">
          <Card x={80} y={77} w={66} h={24} />
          <Dot cx={93} cy={89} r={7} paint="bar" />
          <Bar x={105} y={87} w={30} />
        </Idle>
      </Enter>
    </>
  );
}

/** No deals yet: a blank voucher on its string, another tucked behind. */
function Sponsors() {
  return (
    <>
      <Enter>
        <g transform="translate(8 -16) rotate(9 120 94)">
          <Ticket x={62} y={66} paint="card2" />
        </g>
      </Enter>
      <Enter delay={120}>
        <Idle kind="sway">
          <Ticket x={62} y={66}>
            <Bar x={74} y={80} w={44} h={5} />
            <Bar x={74} y={92} w={30} h={5} />
            <Bar x={74} y={104} w={20} h={4} />
            <circle className={paint.soft} cx={157} cy={94} r={10} />
            <Star cx={157} cy={94} R={5.5} r={2.4} />
          </Ticket>
        </Idle>
      </Enter>
    </>
  );
}

const DRAW = {
  live: Live,
  messages: Messages,
  notifications: Notifications,
  search: Search,
  allies: Allies,
  scheduled: Scheduled,
  wallet: Wallet,
  points: Points,
  broadcasts: Broadcasts,
  offline: Offline,
  cleared: Cleared,
  locked: Locked,
  missing: Missing,
  sponsors: Sponsors,
} satisfies Record<EmptyScene, () => ReactNode>;

/**
 * One scene. Decorative — the Empty's title says what it means. `compact`
 * fits a popover or a narrow pane.
 */
export function EmptySceneArt({ scene, compact = false, className }: { scene: EmptyScene; compact?: boolean; className?: string }) {
  const Draw = DRAW[scene];
  return (
    <ArtCanvas data-scene={scene} className={cn(compact ? "w-[148px]" : "w-[200px] md:w-[236px]", className)}>
      <Ground />
      <Draw />
    </ArtCanvas>
  );
}
