"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/feedback";
import { ClockCounterClockwise, Trash } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { deleteReplay, type ReplayView } from "@/lib/replays";

/** While a replay is processing, the page looks again this often. */
const PROCESSING_POLL_MS = 15_000;

/**
 * An ended broadcast's replay, in the player's place on the stream page:
 * the recorded program (recording.ts on the API), its parts played one after
 * another. Still processing, it says so and looks again until it's ready.
 * The host can delete it from here — for good.
 */
export function ReplayPlayer({
  streamId,
  replay: initial,
  poster,
  isOwner,
}: {
  streamId: string;
  replay: ReplayView;
  poster?: string | null;
  isOwner: boolean;
}) {
  const [replay, setReplay] = useState<ReplayView | null>(initial);
  const [part, setPart] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null);
  /** Moving to the next part keeps playing, as one picture would. */
  const carryOn = useRef(false);

  useEffect(() => {
    if (replay?.status !== "processing") return;
    const t = setInterval(() => {
      apiFetch<{ success: boolean; data: { stream: { replay?: ReplayView | null } } }>(`/api/streams/${streamId}`)
        .then((r) => setReplay(r.data.stream.replay ?? null))
        .catch(() => {});
    }, PROCESSING_POLL_MS);
    return () => clearInterval(t);
  }, [replay?.status, streamId]);

  useEffect(() => {
    if (carryOn.current) void video.current?.play().catch(() => {});
    carryOn.current = false;
  }, [part]);

  if (!replay) return <Plate title="This stream is offline" />;

  if (replay.status === "processing" || replay.status === "recording") {
    return (
      <Plate
        title="The replay is on its way"
        body="It's ready a few minutes after the stream ends — this page picks it up by itself."
        spinner
      />
    );
  }

  if (replay.status === "failed" || replay.parts.length === 0) {
    return <Plate title="This stream is offline" body={isOwner ? "This broadcast couldn't be recorded, so there's no replay." : undefined} />;
  }

  const current = replay.parts[Math.min(part, replay.parts.length - 1)];
  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={video}
        key={current.url}
        src={current.url}
        poster={part === 0 ? (poster ?? undefined) : undefined}
        controls
        playsInline
        preload="metadata"
        className="size-full object-contain"
        onEnded={() => {
          if (part < replay.parts.length - 1) {
            carryOn.current = true;
            setPart((p) => p + 1);
          }
        }}
      />
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-white">
          <ClockCounterClockwise size={12} weight="bold" />
          REPLAY
        </span>
        {replay.parts.length > 1 && (
          <span className="rounded-full bg-black/65 px-2.5 py-1 font-mono text-[11px] font-semibold text-white/85 tabular-nums">
            Part {part + 1} of {replay.parts.length}
          </span>
        )}
      </div>
      {isOwner && <DeleteReplay streamId={streamId} onDeleted={() => setReplay(null)} />}
    </div>
  );
}

function DeleteReplay({ streamId, onDeleted }: { streamId: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteReplay(streamId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete it — try again.");
      setBusy(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Pill size="sm" icon={<Trash size={14} />} className="absolute top-3 right-3 bg-black/65 text-white hover:bg-black/80">
          Delete replay
        </Pill>
      </DialogTrigger>
      <DialogContent title="Delete this replay?" description="It's gone for everyone, for good — the recording can't be brought back.">
        {error && <p className="mb-4 rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error}</p>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Pill variant="ghost">Keep it</Pill>
          </DialogClose>
          <Pill variant="live" onClick={() => void remove()} disabled={busy}>
            {busy ? "Deleting…" : "Delete replay"}
          </Pill>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Plate({ title, body, spinner = false }: { title: string; body?: string; spinner?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center">
      {spinner && <Spinner className="mb-1 size-5 text-white/70" />}
      <p className="font-wide text-[17px] font-bold tracking-[-0.02em] text-white/70">{title}</p>
      {body && <p className="max-w-[340px] text-[13px] leading-relaxed text-white/55">{body}</p>}
    </div>
  );
}
