"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Clock, Crown, HandWaving, Heart, ShieldStar, UsersThree } from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";
import { centsToDollars, giftByEmoji } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { giftUnit, isShout, nameColor, type ChatMsg, type FanStanding } from "./lines";

/**
 * How chat reads, line by line. Flat on purpose (owner, 2026-09-25: "i
 * don't like the glossy looks in the chat") — no capsules, sheens or lit
 * edges. On the panel it's a Twitch-style log: coloured names, small
 * badges, a gift as a quiet block with its amount in gold. Over video it's
 * TikTok's lane: words straight on the picture with a shadow to hold them.
 */
export type ChatSkin = "panel" | "overlay";

/** On video, words need a shadow instead of a box. */
export const ON_VIDEO = "[text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_0_14px_rgba(0,0,0,0.4)]";

export interface Supporter {
  userId?: string;
  username: string;
  displayName?: string;
  avatar: string;
  totalUsdMinor: number;
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Who's speaking: the host, a mod, a top gifter, a fan and how long
 * they've watched, someone from WorldSpace. The fan level is earned by
 * coming back — watching, talking, gifting — and fades if they stop.
 */
export function Badges({
  host,
  mod,
  rank,
  fan,
  platform,
}: {
  host?: boolean;
  mod?: boolean;
  rank?: number;
  fan?: FanStanding;
  platform?: ChatMsg["platform"];
}) {
  return (
    <>
      {host && (
        <span className="mr-1 inline-flex h-4 items-center rounded-[4px] bg-chili px-1 align-[1px] text-[9.5px] font-bold tracking-wide text-white uppercase">
          Host
        </span>
      )}
      {mod && (
        <ShieldStar size={13} weight="fill" aria-label="Moderator" className="mr-1 inline align-[-2px] text-[#86EFAC]" />
      )}
      {rank !== undefined && (
        <span
          title={`Top gifter #${rank}`}
          className={cn(
            "mr-1 inline-flex h-4 items-center rounded-[4px] px-1 align-[1px] font-mono text-[9.5px] font-bold tabular-nums",
            rank === 1 ? "bg-value text-[#1b1406]" : "bg-white/[0.14] text-white/90"
          )}
        >
          No.{rank}
        </span>
      )}
      {!host && fan && fan.level > 0 && (
        <span
          title={`Fan level ${fan.level} · ${fan.hours} ${fan.hours === 1 ? "hour" : "hours"} watched`}
          className={cn(
            "mr-1 inline-flex h-4 items-center gap-0.5 rounded-[4px] px-1 align-[1px] font-mono text-[9.5px] font-bold tabular-nums",
            fan.level >= 9 ? "bg-ember text-on-ember" : fan.level >= 5 ? "bg-ember/25 text-ember-hi" : "bg-white/[0.14] text-white/90"
          )}
        >
          <Heart size={8} weight="fill" aria-hidden />
          {fan.level}
        </span>
      )}
      {!host && fan && fan.badge > 0 && (
        <span
          title={`${fan.hours} hours watched on this channel`}
          className="mr-1 inline-flex h-4 items-center gap-0.5 rounded-[4px] bg-white/[0.14] px-1 align-[1px] font-mono text-[9.5px] font-bold text-white/90 tabular-nums"
        >
          <Clock size={9} weight="bold" aria-hidden />
          {fan.badge}h
        </span>
      )}
      {(platform === "socials" || platform === "worldspace") && (
        <span className="mr-1 inline-flex h-4 items-center rounded-[4px] bg-sky-500/15 px-1 align-[1px] text-[9px] font-bold tracking-wide text-sky-300 uppercase">
          WorldSpace
        </span>
      )}
    </>
  );
}

/** The host's chat marks the line that's on screen right now. */
function OnStream({ skin }: { skin: ChatSkin }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex h-4 items-center gap-1 rounded-[4px] px-1 align-[1px] text-[9.5px] font-bold tracking-wide uppercase",
        skin === "overlay" ? "bg-ember text-on-ember" : "bg-ember/[0.16] text-ember-hi"
      )}
    >
      On stream
    </span>
  );
}

/** Someone speaking — or an emoji reaction, which is just a louder word. */
export function MessageLine({
  msg,
  skin,
  badges,
  highlight = false,
  tools,
  onTap,
  onStream = false,
}: {
  msg: ChatMsg;
  skin: ChatSkin;
  badges: ReactNode;
  /** The line mentions you. */
  highlight?: boolean;
  /** The host's tools for this line, if any. */
  tools?: ReactNode;
  onTap?: () => void;
  /** The host has this line on screen. */
  onStream?: boolean;
}) {
  const reaction = msg.type === "reaction";
  // Held by the filter: only its writer sees it, faded, until a moderator decides.
  const waiting = msg.pending ? (
    <span className={cn("mt-0.5 block text-[11px] font-medium", skin === "overlay" ? "text-white/60" : "text-muted-foreground")}>
      Only you can see this — waiting for a moderator
    </span>
  ) : null;
  if (skin === "overlay") {
    return (
      <div className={cn("group relative flex w-fit max-w-full items-start gap-2 py-[3px]", ON_VIDEO, msg.pending && "opacity-70")} onClick={onTap}>
        <UserAvatar src={msg.avatar} name={msg.username} size={22} className="mt-px size-[22px] shrink-0" />
        <p className="min-w-0 text-[13.5px] leading-snug break-words text-white">
          {badges}
          <span className="mr-1.5 font-semibold text-white/70">{msg.username}</span>
          <span className={cn(reaction && "text-[18px] leading-none")}>{msg.content}</span>
          {onStream && <OnStream skin={skin} />}
          {waiting}
        </p>
        {tools}
      </div>
    );
  }
  return (
    <div
      title={time(msg.at)}
      onClick={onTap}
      className={cn(
        "group relative flex gap-2 rounded-[8px] px-2 py-[5px] transition-colors hover:bg-white/[0.035]",
        highlight && "bg-ember/[0.08] hover:bg-ember/[0.12]",
        msg.pending && "opacity-60"
      )}
    >
      <UserAvatar src={msg.avatar} name={msg.username} size={20} className="mt-[2px] size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-[13px] leading-[1.45] break-words text-foreground/90">
        {badges}
        <span className="mr-1.5 font-semibold" style={{ color: nameColor(msg.username) }}>
          {msg.username}
        </span>
        <span className={cn(reaction && "text-[18px] leading-none")}>{msg.content}</span>
        {onStream && <OnStream skin={skin} />}
        {waiting}
      </p>
      {tools}
    </div>
  );
}

/** A gift, or a run of the same gift (×N) — the room seeing money move. */
export function GiftLine({
  msg,
  count,
  total,
  skin,
  badges,
  tools,
  onTap,
  onStream = false,
}: {
  msg: ChatMsg;
  count: number;
  total: number;
  skin: ChatSkin;
  badges: ReactNode;
  /** The host's tools for this gift, if any. */
  tools?: ReactNode;
  onTap?: () => void;
  /** The host has this gift on screen. */
  onStream?: boolean;
}) {
  const def = giftByEmoji(msg.emoji);
  const unit = giftUnit(msg);
  const shout = isShout(msg);
  // The catalog's verb reads like the room: "lit it up", "crowned the stream".
  // A request's line says what was asked for, which the server wrote.
  const what = shout ? "shouted" : def?.id === "request" ? msg.content : def ? def.verb : msg.content || "tipped";
  const amount =
    unit === "usd"
      ? centsToDollars(total)
      : unit === "pts"
        ? `+${total.toLocaleString()} pts`
        : `${msg.tipAmount} ${msg.tipCurrency}`;
  const big = unit === "usd" && total >= 1000;

  // A Shout is its words: they lead, in the room's own voice.
  if (shout && skin === "overlay") {
    return (
      <div className={cn("group relative flex w-fit max-w-full items-start gap-2 py-[3px]", ON_VIDEO)} onClick={onTap}>
        <GiftArt emoji={msg.emoji ?? "📣"} size={26} className="mt-[-1px] shrink-0" />
        <p className="min-w-0 text-[13.5px] leading-snug text-white">
          {badges}
          <span className="mr-1 font-semibold text-white/70">{msg.username}</span>
          <span className="mr-1.5 font-bold text-value">{amount}</span>
          <span className="font-semibold break-words">{msg.content}</span>
          {onStream && <OnStream skin={skin} />}
        </p>
        {tools}
      </div>
    );
  }
  if (shout) {
    return (
      <div onClick={onTap} className={cn("group relative my-1 rounded-[12px] px-2.5 py-2", big ? "bg-ember/[0.12]" : "bg-white/[0.06]")}>
        <div className="flex items-center gap-2.5">
          <GiftArt emoji={msg.emoji ?? "📣"} size={26} className="shrink-0" />
          <p className="min-w-0 flex-1 truncate text-[12.5px] leading-snug">
            {badges}
            <span className="font-semibold" style={{ color: nameColor(msg.username) }}>
              {msg.username}
            </span>
            <span className="text-foreground/60"> shouted</span>
            {onStream && <OnStream skin={skin} />}
          </p>
          <span className="shrink-0 font-mono text-[13px] font-bold text-value tabular-nums">{amount}</span>
          {tools}
        </div>
        <p className="mt-1 pl-[36px] text-[14.5px] leading-snug font-medium break-words text-foreground">{msg.content}</p>
      </div>
    );
  }

  if (skin === "overlay") {
    return (
      <div className={cn("group relative flex w-fit max-w-full items-center gap-2 py-[3px]", ON_VIDEO)} onClick={onTap}>
        <GiftArt emoji={msg.emoji ?? "🎁"} size={30} className="-my-1 shrink-0" />
        <p className="min-w-0 text-[13.5px] leading-snug text-white">
          {badges}
          <span className="mr-1 font-semibold text-white/70">{msg.username}</span>
          {what}
          {count > 1 && <span className="ml-1 font-mono font-bold">×{count}</span>}
          <span className={cn("ml-1.5 font-bold", unit === "pts" ? "text-ember-hi" : "text-value")}>{amount}</span>
          {onStream && <OnStream skin={skin} />}
        </p>
        {tools}
      </div>
    );
  }
  return (
    <div
      onClick={onTap}
      className={cn("group relative my-1 flex items-center gap-3 rounded-[12px] px-2.5 py-2", big ? "bg-ember/[0.12]" : "bg-white/[0.045]")}
    >
      <GiftArt emoji={msg.emoji ?? "🎁"} size={big ? 40 : 30} className="shrink-0" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        {badges}
        <span className="font-semibold" style={{ color: nameColor(msg.username) }}>
          {msg.username}
        </span>
        <span className="text-foreground/75"> {what}</span>
        {count > 1 && <span className="ml-1 font-mono text-[12px] font-bold text-foreground">×{count}</span>}
        {onStream && <OnStream skin={skin} />}
      </p>
      <span className={cn("shrink-0 font-mono text-[13px] font-bold tabular-nums", unit === "pts" ? "text-ember-hi" : "text-value")}>
        {amount}
      </span>
      {tools}
    </div>
  );
}

/** A run of drops as one line: the faces, who caught them, the points. */
export function DropsLine({ catches, skin }: { catches: ChatMsg[]; skin: ChatSkin }) {
  // Newest first, each person once.
  const people: ChatMsg[] = [];
  for (let i = catches.length - 1; i >= 0; i--) {
    if (!people.some((p) => p.username === catches[i].username)) people.push(catches[i]);
  }
  const others = people.length - 1;
  const points = catches.reduce((n, c) => n + (Number(c.tipAmount) || 0), 0);
  const overlay = skin === "overlay";
  return (
    <div className={cn("flex items-center gap-2", overlay ? cn("w-fit max-w-full py-[3px]", ON_VIDEO) : "px-2 py-[5px]")}>
      <span className="flex shrink-0 -space-x-1.5">
        {people.slice(0, 3).map((p) => (
          <UserAvatar
            key={p.username}
            src={p.avatar}
            name={p.username}
            size={overlay ? 20 : 18}
            className={cn("ring-2", overlay ? "size-5 ring-black/60" : "size-[18px] ring-background")}
          />
        ))}
      </span>
      <p className={cn("min-w-0 flex-1 text-[12.5px] leading-snug", overlay ? "text-white/85" : "text-muted-foreground")}>
        <span className={cn("font-semibold", overlay ? "text-white" : "text-foreground/90")}>{people[0].username}</span>
        {others > 0 && ` and ${others} other${others === 1 ? "" : "s"}`}
        {catches.length === 1 ? " caught a drop" : ` caught ${catches.length} drops`}
        <span className="ml-1.5 font-semibold whitespace-nowrap text-ember-hi">+{points.toLocaleString()} pts</span>
      </p>
    </div>
  );
}

/** Someone joining or leaving the stage — the room's own news. */
export function StageLine({ msg, skin }: { msg: ChatMsg; skin: ChatSkin }) {
  const overlay = skin === "overlay";
  return (
    <p className={cn("flex items-center gap-1.5 text-[12px]", overlay ? cn("w-fit py-[3px] text-white/80", ON_VIDEO) : "px-2 py-[5px] text-muted-foreground")}>
      <UsersThree size={13} weight="fill" className="shrink-0 text-ember-hi" />
      <span>
        <span className={cn("font-semibold", overlay ? "text-white" : "text-foreground/90")}>{msg.username}</span> {msg.content}
      </span>
    </p>
  );
}

/**
 * Arrivals as a ticker, not rows: in a busy room a row per join drowned the
 * conversation. One line, the latest name, and how many came with them.
 */
export function ArrivalTicker({
  arrival,
  skin,
}: {
  arrival: { name: string; others: number; key: number } | null;
  skin: ChatSkin;
}) {
  if (!arrival) return null;
  const overlay = skin === "overlay";
  return (
    <p
      key={arrival.key}
      aria-live="polite"
      className={cn(
        "flex animate-in items-center gap-1.5 text-[12px] duration-300 fade-in slide-in-from-bottom-1",
        overlay ? cn("pointer-events-none w-fit pb-1.5 text-white/80", ON_VIDEO) : "px-4 pb-2 text-muted-foreground"
      )}
    >
      <HandWaving size={13} weight="fill" className="shrink-0 text-ember-hi" />
      <span className="min-w-0 truncate">
        <span className={cn("font-semibold", overlay ? "text-white" : "text-foreground/90")}>{arrival.name}</span>
        {arrival.others > 0 && ` and ${arrival.others} other${arrival.others === 1 ? "" : "s"}`} joined
      </span>
    </p>
  );
}

/** Someone high on a stream's fan board, and what put them there. */
export interface TopFan {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  score: number;
  minutes: number;
  chats: number;
  giftsMinor: number;
}

function watched(minutes: number) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

/**
 * The room's leaders, heading the chat the way Twitch's leaderboard does.
 * Two boards: top gifters — rank, face, name and what they've given, in
 * gold because it's money — and top fans, where watching and talking count
 * as well as gifts, so status isn't only bought. Signed in, the fans board
 * also says where you stand.
 */
export function TopGiftersBar({
  gifters,
  fans = [],
  me = null,
}: {
  gifters: Supporter[];
  fans?: TopFan[];
  me?: FanStanding | null;
}) {
  const [picked, setPicked] = useState<"gifts" | "fans">("gifts");
  if (gifters.length === 0 && fans.length === 0) return null;
  // An empty board isn't worth a tab: show the one with people on it.
  const view = gifters.length === 0 ? "fans" : fans.length === 0 ? "gifts" : picked;
  const tab = (id: "gifts" | "fans", label: string, icon: ReactNode, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      disabled={count === 0}
      onClick={() => setPicked(id)}
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40",
        view === id ? "bg-white text-[#0b0708]" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    // Fades at the right edge when there are more than fit: the eye reads "scroll for more".
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto px-4 pb-3 scrollbar-none [mask-image:linear-gradient(to_right,black_88%,transparent)]">
      <div role="tablist" aria-label="Top of the room" className="flex shrink-0 items-center rounded-full bg-white/[0.05] p-0.5">
        {tab("gifts", "Gifts", <Crown size={12} weight="fill" className={view === "gifts" ? "" : "text-value"} />, gifters.length)}
        {tab("fans", "Fans", <Heart size={11} weight="fill" className={view === "fans" ? "" : "text-ember-hi"} />, fans.length)}
      </div>
      {view === "gifts"
        ? gifters.slice(0, 5).map((g, i) => (
            <Link
              key={g.userId ?? g.username}
              href={`/c/${g.username}`}
              title={`${g.displayName || g.username} · ${centsToDollars(g.totalUsdMinor)}`}
              className="press flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.05] py-1 pr-2.5 pl-1 transition-colors hover:bg-white/[0.09]"
            >
              <UserAvatar src={g.avatar} name={g.displayName || g.username} size={22} className="size-[22px]" />
              <span className={cn("font-mono text-[10.5px] font-bold", i === 0 ? "text-value" : "text-muted-foreground")}>
                {i + 1}
              </span>
              <span className="max-w-[6.5rem] truncate text-[12px] font-semibold text-foreground/90">{g.displayName || g.username}</span>
              <span className="font-mono text-[11.5px] font-semibold text-value tabular-nums">{centsToDollars(g.totalUsdMinor)}</span>
            </Link>
          ))
        : fans.slice(0, 5).map((f, i) => (
            <Link
              key={f.userId}
              href={`/c/${f.username}`}
              title={`${f.displayName} · ${watched(f.minutes)} watched · ${f.chats} ${f.chats === 1 ? "message" : "messages"}${f.giftsMinor ? ` · ${centsToDollars(f.giftsMinor)} gifted` : ""}`}
              className="press flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.05] py-1 pr-2.5 pl-1 transition-colors hover:bg-white/[0.09]"
            >
              <UserAvatar src={f.avatar} name={f.displayName} size={22} className="size-[22px]" />
              <span className={cn("font-mono text-[10.5px] font-bold", i === 0 ? "text-ember-hi" : "text-muted-foreground")}>{i + 1}</span>
              <span className="max-w-[6.5rem] truncate text-[12px] font-semibold text-foreground/90">{f.displayName}</span>
              <span className="flex items-center gap-0.5 font-mono text-[11.5px] font-semibold text-ember-hi tabular-nums">
                <Heart size={9} weight="fill" aria-hidden />
                {f.score.toLocaleString("en-US")}
              </span>
            </Link>
          ))}
      {view === "fans" && me && me.level > 0 && (
        <span
          title={`${me.hours} ${me.hours === 1 ? "hour" : "hours"} watched on this channel`}
          className="flex shrink-0 items-center gap-1 rounded-full bg-ember/15 px-2.5 py-1 text-[11.5px] font-semibold text-ember-hi"
        >
          You · level {me.level}
        </span>
      )}
    </div>
  );
}
