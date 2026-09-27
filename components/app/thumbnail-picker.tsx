"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "@/components/icons";
import { Pill, Skeleton } from "@/components/xtream";
import { apiUrl } from "@/lib/api-client";
import { chooseThumbnail, loadThumbnailChoices, type ThumbnailChoices } from "@/lib/thumbnail-candidates";
import { cn } from "@/lib/utils";

/**
 * "Pick a thumbnail" after a broadcast: the thumbnail the stream has now,
 * beside the (up to) three frames the studio kept while live — the
 * sharpest, best-lit moments, spread across the show. One tap makes a frame
 * the thumbnail everywhere the stream's card shows.
 *
 * Renders nothing when the stream kept no frames (an encoder stream, one
 * from before this, or one too short to grab from), so it can sit anywhere
 * a broadcast is shown. Flat Afterglow: 10 px corners, the ember line marks
 * what's in use, no blur.
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

function minutesIn(at: string, startedAt: string | null) {
  if (!startedAt) return null;
  const m = Math.max(0, Math.round((new Date(at).getTime() - new Date(startedAt).getTime()) / 60_000));
  return m === 0 ? "At the start" : `${m} min in`;
}

export function ThumbnailPicker({
  streamId,
  title = "Pick a thumbnail",
  note = "Frames from the stream, picked for sharpness and light. Tap one to use it.",
  onClose,
  onPicked,
  bare = false,
  className,
}: {
  streamId: string;
  title?: string;
  note?: string;
  /** A close control in the corner (the studio's after-stream card). */
  onClose?: () => void;
  /** The new thumbnail's URL (API-relative), once it's set. */
  onPicked?: (thumbnailUrl: string | null) => void;
  /** No heading or surface of its own (inside a dialog that has both). */
  bare?: boolean;
  className?: string;
}) {
  const [choices, setChoices] = useState<ThumbnailChoices | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadThumbnailChoices(streamId)
      .then((data) => alive && setChoices(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [streamId]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const flash = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const pick = async (candidateId: string) => {
    if (busy) return;
    setBusy(candidateId);
    try {
      const data = await chooseThumbnail(streamId, candidateId);
      setChoices((prev) => (prev ? { ...prev, thumbnailUrl: data.thumbnailUrl, candidates: data.candidates } : prev));
      onPicked?.(data.thumbnailUrl);
      flash("Thumbnail updated");
    } catch {
      flash("Couldn't update the thumbnail. Try again.");
    } finally {
      setBusy(null);
    }
  };

  // Nothing kept, or nothing to show: stay out of the way.
  if (failed || (choices && choices.candidates.length === 0)) return null;

  const currentIsCandidate = choices?.candidates.some((c) => c.current) ?? false;

  return (
    <section aria-label={title} className={cn(!bare && "rounded-[10px] bg-surface p-4", className)}>
      {!bare && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold">{title}</p>
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{note}</p>
          </div>
          {onClose && <Pill variant="ghost" size="sm" iconOnly icon={<X size={14} />} aria-label="Dismiss" onClick={onClose} className="-mt-1 -mr-1.5" />}
        </div>
      )}

      {!choices ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-video rounded-[10px]" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          <li>
            <figure className="min-w-0">
              <div className={cn("relative aspect-video overflow-hidden rounded-[10px] bg-control", !currentIsCandidate && "outline-2 outline-offset-2 outline-ember")}>
                {choices.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the API's versioned thumbnail URL
                  <img src={apiUrl(choices.thumbnailUrl)} alt="The current thumbnail" className="absolute inset-0 size-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">No thumbnail yet</span>
                )}
              </div>
              <figcaption className={cn(EYEBROW, "mt-1.5")}>Current</figcaption>
            </figure>
          </li>
          {choices.candidates.map((c, i) => {
            const when = minutesIn(c.at, choices.startedAt);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void pick(c.id)}
                  disabled={Boolean(busy) || c.current}
                  aria-pressed={c.current}
                  aria-label={`Use frame ${i + 1}${when ? `, ${when}` : ""} as the thumbnail`}
                  className="press group block w-full min-w-0 text-left outline-none disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "relative block aspect-video overflow-hidden rounded-[10px] bg-control transition-[outline-color] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ember/60",
                      c.current && "outline-2 outline-offset-2 outline-ember",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URI frame */}
                    <img src={c.image} alt="" className={cn("absolute inset-0 size-full object-cover transition-opacity", busy && busy !== c.id && "opacity-60")} />
                    {c.current && (
                      <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-ember text-on-ember">
                        <Check size={14} weight="bold" />
                      </span>
                    )}
                    {busy === c.id && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" /></span>}
                  </span>
                  <span className={cn(EYEBROW, "mt-1.5 block", c.current && "text-ember-hi")}>{c.current ? "In use" : (when ?? `Frame ${i + 1}`)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {toast &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            style={{ zIndex: "var(--layer-toast)" }}
            className="pointer-events-none fixed inset-x-0 bottom-[max(24px,env(safe-area-inset-bottom))] flex justify-center px-4"
          >
            <span className="rounded-full bg-inverse px-4 py-2.5 text-[13.5px] font-semibold text-on-inverse shadow-overlay">{toast}</span>
          </div>,
          document.body,
        )}
    </section>
  );
}
