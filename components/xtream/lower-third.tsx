import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { LiveBadge } from "@/components/ui/badge";

/**
 * The lower third — On Air's flow, in Afterglow's skin. Who is on the
 * stage, said the way broadcast says it: the tally, the face in its heat
 * ring, the name set wide, and one line of what's happening. Sits on the
 * picture (the object language: black at 55%, hairline, lit top), bottom-
 * left above the chat on a phone, or over a co-host's tile on the stage.
 *
 * `action` takes the one thing a viewer can do right there — usually the
 * FollowButton ("Ally").
 */
export function LowerThird({
  name,
  meta,
  avatar,
  live = true,
  action,
  size = "md",
  className,
}: {
  name: string;
  meta?: ReactNode;
  avatar?: string | null;
  live?: boolean;
  action?: ReactNode;
  size?: "md" | "lg";
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <div
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-2.5 rounded-full bg-black/55 py-1 pr-1.5 pl-1 text-white",
        !action && "pr-4",
        className,
      )}
    >
      <UserAvatar
        src={avatar}
        name={name}
        size={lg ? 40 : 32}
        ring={live ? "live" : "seen"}
        ringGapClassName="bg-black"
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate font-wide font-bold tracking-[-0.025em]", lg ? "text-[18px]" : "text-[14.5px]")}>{name}</span>
          {live && <LiveBadge size="xs" />}
        </span>
        {meta && <span className={cn("truncate text-white/68", lg ? "text-[13px]" : "text-[11.5px]")}>{meta}</span>}
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
