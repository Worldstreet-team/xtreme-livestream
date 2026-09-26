"use client";

import { Phone, PhoneX, VideoCamera } from "@/components/icons";
import { cn } from "@/lib/utils";
import { callOutcome, clockTime } from "@/lib/messaging";

/**
 * A finished call, in the thread. Not a speech bubble — a call isn't
 * something either person said — but a small card on the caller's side
 * (the caller logs it, so the sender is the caller). A missed call offers
 * the one thing you want from it: to call back.
 */
export function CallLogRow({
  content,
  at,
  mine,
  onCallBack,
}: {
  content: string;
  at: string;
  mine: boolean;
  /** Absent while a call is already on. */
  onCallBack?: (video: boolean) => void;
}) {
  const { missed, video } = callOutcome(content);
  const Glyph = missed ? PhoneX : video ? VideoCamera : Phone;
  return (
    <div className={cn("my-3 flex", mine ? "justify-end" : "justify-start pl-9")}>
      <div className="flex items-center gap-3 rounded-[20px] bg-control py-2 pr-2 pl-2.5">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            missed ? "bg-chili/15 text-chili-hi" : "bg-success/15 text-success",
          )}
        >
          <Glyph size={17} weight="fill" aria-hidden />
        </span>
        <span className="min-w-0 pr-1 leading-tight">
          <span className="block truncate text-[13.5px] font-medium text-foreground">{content || "Call"}</span>
          <span className="block text-[11.5px] text-muted-foreground tabular-nums">{clockTime(at)}</span>
        </span>
        {missed && onCallBack && (
          <button
            type="button"
            onClick={() => onCallBack(video)}
            className="msg-press ml-1 h-8 shrink-0 rounded-full bg-white px-3.5 text-[12.5px] font-semibold text-[#0b0708] hover:bg-white/90"
          >
            Call back
          </button>
        )}
      </div>
    </div>
  );
}
