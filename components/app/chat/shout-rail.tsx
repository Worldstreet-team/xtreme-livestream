"use client";

import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";
import { SHOUT_GIFT, centsToDollars } from "@/lib/gifts";
import { serverNow } from "@/lib/server-clock";
import { cn } from "@/lib/utils";
import { giftAmount, nameColor, type ChatMsg } from "./lines";
import { ON_VIDEO, type ChatSkin } from "./chat-lines";

/** "4:07" left, or "1:02:10" for the hour-long ones. */
function left(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Shouts still pinned, over the chat: a chip each — who, and what they
 * paid — with a line that runs down as the pin does. Bigger Shouts sit
 * first. On the panel the top one reads out in full; tap another to read
 * it. Over video it's chips only until tapped, so the picture stays clear.
 */
export function ShoutRail({ shouts, skin }: { shouts: ChatMsg[]; skin: ChatSkin }) {
  const overlay = skin === "overlay";
  const [now, setNow] = useState(() => serverNow());
  /** The Shout read out: null is the default (the top one on the panel), "none" is closed. */
  const [openId, setOpenId] = useState<string | null>(null);

  const pinned = shouts
    .filter((s) => s.shoutUntil && Date.parse(s.shoutUntil) > now)
    .sort((a, b) => giftAmount(b) - giftAmount(a) || b.at - a.at);
  const any = pinned.length > 0;

  useEffect(() => {
    if (!any) return;
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [any]);

  if (!any) return null;
  const open =
    openId === "none" ? null : (pinned.find((p) => p.id === openId) ?? (overlay || openId !== null ? null : pinned[0]));

  return (
    <div className={cn(overlay ? "pointer-events-auto mb-1.5 max-w-full" : "mx-2 mb-2")}>
      <ul className="flex gap-1.5 overflow-x-auto scrollbar-none" aria-label="Pinned Shouts">
        {pinned.map((s) => {
          const until = Date.parse(s.shoutUntil!);
          const span = Math.max(1, until - s.at);
          const share = Math.min(1, Math.max(0, (until - now) / span));
          const on = open?.id === s.id;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                aria-expanded={on}
                aria-label={`${s.username}'s Shout, ${centsToDollars(giftAmount(s))}, ${left(until - now)} left`}
                onClick={() => setOpenId(on ? "none" : s.id)}
                className={cn(
                  "press relative flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-full pr-3 pl-1 transition-colors",
                  overlay ? (on ? "bg-black/80" : "bg-black/60") : on ? "bg-white/[0.12]" : "bg-white/[0.06] hover:bg-white/[0.09]"
                )}
              >
                <UserAvatar src={s.avatar} name={s.username} size={24} className="size-6" />
                <span className="font-money text-[13px] leading-none text-value tabular-nums">{centsToDollars(giftAmount(s))}</span>
                <span aria-hidden className="absolute inset-x-2.5 bottom-[3px] h-[2px] rounded-full bg-white/[0.1]">
                  <span className="block h-full rounded-full bg-ember transition-[width] duration-1000 ease-linear" style={{ width: `${share * 100}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <div
          className={cn(
            "mt-1.5 rounded-[12px] px-3 py-2.5 motion-safe:animate-[fade-in_200ms_ease-out_both]",
            overlay ? "w-fit max-w-full bg-black/70" : "bg-white/[0.06]"
          )}
        >
          <p className="flex min-w-0 items-center gap-1.5 text-[12px]">
            <GiftArt art={SHOUT_GIFT.art} emoji={SHOUT_GIFT.emoji} size={18} className="-my-1" />
            <span className="min-w-0 truncate font-semibold" style={{ color: overlay ? undefined : nameColor(open.username) }}>
              {open.username}
            </span>
            <span className="shrink-0 font-money text-value tabular-nums">{centsToDollars(giftAmount(open))}</span>
            <span className={cn("ml-auto shrink-0 pl-2 font-mono text-[11px] tabular-nums", overlay ? "text-white/60" : "text-muted-foreground")}>
              {left(Date.parse(open.shoutUntil!) - now)}
            </span>
          </p>
          <p className={cn("mt-1 text-[14px] leading-snug font-medium break-words", overlay ? cn("text-white", ON_VIDEO) : "text-foreground")}>
            {open.content}
          </p>
        </div>
      )}
    </div>
  );
}
