"use client";

import { SignOut } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { DeviceCheck } from "@/components/app/device-check";
import type { AttachableVideoTrack } from "@/components/app/stage-tile";
import { cn } from "@/lib/utils";

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * Backstage, from the guest's side: the host accepted them and they're in
 * the room with camera and mic on, seen by the host and their producers
 * only, until they're brought on. So — a mirror, a mic meter, and the way
 * out. Stacks on a phone, sits side by side where there's room.
 */
export function BackstagePanel({
  video,
  audio,
  micOn,
  camOn = true,
  onToggleMic,
  onToggleCam,
  onLeave,
  busy = false,
  className,
}: {
  video: AttachableVideoTrack | null;
  audio: MediaStreamTrack | null;
  micOn: boolean;
  camOn?: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
  onLeave: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="backstage-title"
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5", className)}
    >
      <DeviceCheck
        video={video}
        audio={audio}
        micOn={micOn}
        camOn={camOn}
        onToggleMic={onToggleMic}
        onToggleCam={onToggleCam}
        className="sm:w-[300px] sm:shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <p className={cn(EYEBROW, "flex items-center gap-1.5")}>
          {/* Ember: on, but not on air. */}
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-ember" />
          Backstage
        </p>
        <h3 id="backstage-title" className="mt-1.5 font-wide text-[17px] font-bold tracking-[-0.02em] text-foreground">
          You&apos;re backstage.
        </h3>
        <p className="mt-1.5 text-[13.5px] leading-snug text-muted-foreground">
          The host can see and hear you; viewers can&apos;t. Check your camera and mic — they&apos;ll bring you on when
          they&apos;re ready.
        </p>
        <Pill
          variant="soft"
          tone="red"
          icon={<SignOut size={16} />}
          onClick={onLeave}
          disabled={busy}
          className="mt-4"
        >
          Leave backstage
        </Pill>
      </div>
    </section>
  );
}
