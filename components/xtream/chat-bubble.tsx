"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";

/**
 * One line of live chat, Afterglow: a lit bubble with the sender's face,
 * their name in their own warm tint, and the message. Kinds:
 *   message  the default
 *   host     the streamer — their face wears an Ember ring
 *   gift     a gift in the chat — warm glow, the gift's face, amount in heat
 *   system   the room talking (someone joined, the battle started) — muted
 * On a picture (the default) it wears the object language; on a surface
 * (the studio drawer) it drops to a quiet fill.
 */
export type ChatKind = "message" | "host" | "gift" | "system";

/** Names get one of a few warm tints — stable per name, readable on black. */
const TINTS = ["#FFC7B5", "#B9F0D2", "#C9D4FF", "#FFE3A3", "#F4C2FF", "#A8E6F0"];
function tint(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

export function ChatBubble({
  kind = "message",
  name,
  avatar,
  children,
  giftEmoji,
  giftArt,
  amountLabel,
  onPicture = true,
  className,
}: {
  kind?: ChatKind;
  name: string;
  avatar?: string | null;
  children?: ReactNode;
  /** For `gift`: the gift's face. */
  giftEmoji?: string;
  giftArt?: string;
  /** For `gift`: preformatted, e.g. "$2,500". */
  amountLabel?: string;
  onPicture?: boolean;
  className?: string;
}) {
  const surface = onPicture
    ? "bg-black/52 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]"
    : "bg-white/[0.05] shadow-[inset_0_0_0_1px_rgba(255,236,230,0.06)]";

  if (kind === "system") {
    return (
      <p className={cn("w-fit max-w-full rounded-full px-3 py-1 text-[12px] text-muted-foreground", onPicture && "bg-black/40 text-white/70", className)}>
        {children}
      </p>
    );
  }

  const gift = kind === "gift";
  return (
    <div
      className={cn(
        "flex w-fit max-w-full items-center gap-2 rounded-[17px] py-1 pr-3 pl-1 text-[13px] leading-snug text-foreground",
        onPicture && "text-white",
        gift
          ? "bg-[linear-gradient(90deg,rgba(248,88,16,0.34),rgba(0,0,0,0.52)_72%)] shadow-[inset_0_0_0_1px_rgba(248,120,16,0.45),0_8px_24px_-10px_rgba(248,88,16,0.85)]"
          : surface,
        className,
      )}
    >
      {gift ? (
        <GiftArt emoji={giftEmoji} art={giftArt} size={22} className="shrink-0" />
      ) : (
        <span className={cn("shrink-0 rounded-full", kind === "host" && "p-[1.5px] bg-ember")}>
          <UserAvatar src={avatar} name={name} size={22} className={cn(kind === "host" && "ring-[1.5px] ring-black")} />
        </span>
      )}
      <span className="min-w-0">
        <b className="mr-1.5 font-bold" style={{ color: kind === "host" ? "#FFFFFF" : tint(name) }}>
          {name}
        </b>
        {children}
        {gift && amountLabel && (
          <span className="ml-1.5 inline-block rounded-full bg-heat px-1.5 py-0.5 align-[1px] text-[10.5px] leading-none font-bold text-white">
            {amountLabel}
          </span>
        )}
      </span>
    </div>
  );
}
