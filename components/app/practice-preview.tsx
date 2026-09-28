"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Eye } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { PillLink } from "@/components/ui/pill";
import { Empty } from "@/components/app/empty";

/**
 * The viewer's side of a practice preview: someone opened a host's secret
 * link to a practice run (`/stream/<id>?preview=<key>`). They can watch —
 * only watch. The API holds the line (a hidden, subscribe-only token, and
 * every chat/gift/like/game route refuses a practice run); this is what the
 * page shows them: a banner the whole time, a PRACTICE badge where LIVE
 * would be, and a plain end when the run is over or the host stops sharing.
 */

/** A preview key as the API makes them: base64url (32 characters). "true" and friends aren't keys. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export interface PreviewMode {
  /** Watching on a preview link. */
  on: boolean;
  /** `?previewKey=…` for the stream and token requests, or "" when not previewing. */
  query: string;
}

/** Is this page a practice preview? Reads `?preview=` from the address. */
export function usePreviewMode(): PreviewMode {
  const raw = useSearchParams()?.get("preview") ?? null;
  const key = raw && KEY_SHAPE.test(raw) ? raw : null;
  return useMemo(() => ({ on: key !== null, query: key ? `?previewKey=${encodeURIComponent(key)}` : "" }), [key]);
}

/** Where LIVE would be: a rehearsal isn't on air. Ember, as in the host's studio. */
export function PracticeBadge({ size = "md" }: { size?: "xs" | "sm" | "md" }) {
  return (
    <Badge variant="ember" size={size} className="uppercase">
      Practice
    </Badge>
  );
}

/**
 * The banner, up the whole time the preview plays — and, once the run is
 * over or the link is stopped, the end of it. Rendered in place of the
 * page's "stream ended" sheet, which would offer the live list and count
 * down to Explore.
 */
export function PreviewBanner({ ended, hostName, channelHref }: { ended: boolean; hostName: string; channelHref: string }) {
  if (ended) {
    return (
      <div className="animate-fade-in fixed inset-0 z-[75] flex items-end justify-center bg-black/80 sm:items-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-ended-title"
          className="w-full rounded-t-[20px] bg-surface-raised px-5 pt-6 pb-[max(env(safe-area-inset-bottom),20px)] shadow-overlay sm:max-w-[420px] sm:rounded-[20px] sm:p-7"
        >
          <PracticeBadge size="sm" />
          <h2 id="preview-ended-title" className="mt-3 font-wide text-[21px] leading-tight font-bold tracking-[-0.03em] text-balance text-foreground">
            This preview has ended
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {hostName} wrapped up the practice run or stopped sharing it. None of it was live, and the link no longer works.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <PillLink href={channelHref} variant="primary" size="lg" className="w-full">
              Visit {hostName}&apos;s channel
            </PillLink>
            <PillLink href="/explore" variant="ghost" size="lg" className="w-full">
              See who&apos;s live
            </PillLink>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-3 top-[calc(max(env(safe-area-inset-top),12px)+96px)] z-[65] flex justify-center md:top-[4.5rem]"
    >
      <p className="obj flex max-w-full items-center gap-2.5 rounded-[18px] py-1.5 pr-4 pl-4 text-[12.5px] leading-snug text-white md:rounded-full md:pl-1.5">
        {/* A phone already wears PRACTICE in its top bar, right above. */}
        <span className="hidden md:inline-flex">
          <PracticeBadge size="sm" />
        </span>
        <span className="min-w-0">
          <span className="font-semibold">Practice run, not live.</span>{" "}
          <span className="text-white/75">You&apos;re watching a private preview.</span>
        </span>
        <Eye size={14} className="hidden shrink-0 text-white/60 sm:block" />
      </p>
    </div>
  );
}

/** Opened a preview link that no longer works (or never did): no stream, and no hint whether one exists. */
export function PreviewGone() {
  return (
    <Empty
      className="min-h-screen"
      scene="locked"
      title="This preview isn't available"
      body="Preview links work only while the practice run is on, and until the host stops sharing."
      action={{ label: "See who's live", href: "/explore" }}
      goLive={false}
    />
  );
}
