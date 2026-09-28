"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, Check, Copy, Eye, ShareNetwork, Stop } from "@/components/icons";
import { apiFetch, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * "Share preview", in the studio's More panel while a practice run is on:
 * a secret link anyone can watch the rehearsal on — only watch (the API's
 * preview routes, services/api/src/routes/preview.ts). Copy it, or hand it
 * to the phone's share sheet; stop sharing whenever; it dies with the run.
 *
 * The API gives the key out once. The link is kept in this tab's
 * sessionStorage so the panel can offer it again after a close or a
 * reload; on another device, "New link" makes a fresh one (and retires the
 * old). On screen it's masked — the studio can be on someone else's screen.
 */

interface PreviewStatus {
  shared: boolean;
  sharedAt: string | null;
  watching: number | null;
}

const POLL_MS = 15_000;
const storeKey = (streamId: string) => `xt:practice-preview:${streamId}`;

function readLink(streamId: string): { url: string; sharedAt: string } | null {
  try {
    const raw = sessionStorage.getItem(storeKey(streamId));
    return raw ? (JSON.parse(raw) as { url: string; sharedAt: string }) : null;
  } catch {
    return null;
  }
}
function writeLink(streamId: string, link: { url: string; sharedAt: string } | null) {
  try {
    if (link) sessionStorage.setItem(storeKey(streamId), JSON.stringify(link));
    else sessionStorage.removeItem(storeKey(streamId));
  } catch {
    // Private mode or storage off: the link just isn't offered again after a reload.
  }
}

/** The phone's share sheet, where there is one and it's a phone. */
function canShareSheet() {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

const ROW = "press flex h-11 items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";

export function PracticeShare({ streamId }: { streamId: string | null }) {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [link, setLink] = useState<{ url: string; sharedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sheet] = useState(canShareSheet);

  const load = useCallback(async () => {
    if (!streamId) return;
    try {
      const res = await apiFetch<{ success: boolean; data: PreviewStatus }>(`/api/streams/${streamId}/preview`);
      setStatus(res.data);
      // A link from a run that's since been stopped (or replaced elsewhere) is no link.
      const kept = readLink(streamId);
      if (!res.data.shared || (kept && kept.sharedAt !== res.data.sharedAt)) {
        writeLink(streamId, null);
        setLink(null);
      } else {
        setLink(kept);
      }
    } catch {
      // The count is a nicety; the buttons still work.
    }
  }, [streamId]);

  useEffect(() => {
    if (!streamId) return;
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(poll);
  }, [streamId, load]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const flashCopied = () => {
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1800);
  };

  /** Share sheet on a phone, clipboard elsewhere. `quiet`: right after making the link, where a browser may refuse the clipboard — Copy link is right there. */
  const hand = async (url: string, quiet = false) => {
    if (sheet) {
      try {
        await navigator.share({ title: "Practice run preview", text: "Watch my practice run — it's a private preview, not live.", url });
        return;
      } catch (err) {
        // Dismissed is fine; anything else falls through to the clipboard.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flashCopied();
    } catch {
      if (!quiet) setError("Couldn't copy — select Copy link again.");
    }
  };

  const makeLink = async () => {
    if (!streamId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; data: { key: string; path: string; sharedAt: string; watching: number } }>(
        `/api/streams/${streamId}/preview`,
        { method: "POST" },
      );
      const next = { url: `${window.location.origin}${res.data.path}`, sharedAt: res.data.sharedAt };
      writeLink(streamId, next);
      setLink(next);
      setStatus({ shared: true, sharedAt: res.data.sharedAt, watching: 0 });
      await hand(next.url, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't make a link — try again.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!streamId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/preview`, { method: "DELETE" });
      writeLink(streamId, null);
      setLink(null);
      setStatus({ shared: false, sharedAt: null, watching: 0 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't stop sharing — try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!streamId) {
    return (
      <p className="rounded-[12px] bg-ember/[0.1] px-3.5 py-3 text-[12.5px] leading-snug text-foreground/85">
        A practice run is private — nothing here is announced or paid. Once it&apos;s on, you can share a watch-only preview link.
      </p>
    );
  }

  const shared = Boolean(status?.shared);
  const watching = status?.watching ?? null;
  // The link on screen, key hidden: the studio may be on someone else's screen.
  const masked = link ? `${link.url.replace(/^https?:\/\//, "").split("?")[0]}?preview=••••••` : null;

  return (
    <div className="rounded-[12px] bg-ember/[0.1] p-3.5" data-tour="studio-practice-share">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-foreground">{shared ? "Preview link is on" : "Share a preview"}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            {shared
              ? "Anyone with the link can watch — only watch. It stops working when the run ends."
              : "A private link to watch this practice run. No chat, gifts or likes, and it's never listed."}
          </p>
        </div>
        {shared && watching !== null && (
          <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-tint/[0.08] px-2.5 font-mono text-[12px] font-semibold text-foreground tabular-nums" aria-live="polite">
            <Eye size={13} weight="bold" />
            {watching} watching
          </span>
        )}
      </div>

      {shared && masked && <p className="mt-2.5 truncate font-mono text-[11.5px] text-muted-foreground/80">{masked}</p>}

      <div className="mt-3 flex flex-col gap-2">
        {!shared ? (
          <button type="button" onClick={() => void makeLink()} disabled={busy} className={cn(ROW, "bg-ember text-on-ember hover:brightness-105")}>
            {sheet ? <ShareNetwork size={16} weight="fill" /> : <Copy size={16} />}
            {busy ? "Making the link…" : "Share preview"}
          </button>
        ) : link ? (
          <button type="button" onClick={() => void hand(link.url)} disabled={busy} className={cn(ROW, "bg-ember text-on-ember hover:brightness-105")}>
            {copied ? <Check size={16} weight="bold" /> : sheet ? <ShareNetwork size={16} weight="fill" /> : <Copy size={16} />}
            {copied ? "Link copied" : sheet ? "Share link" : "Copy link"}
          </button>
        ) : (
          // Made on another device, or before a reload that lost it: the key isn't kept anywhere to show again.
          <button type="button" onClick={() => void makeLink()} disabled={busy} className={cn(ROW, "bg-ember text-on-ember hover:brightness-105")}>
            <ArrowClockwise size={16} weight="bold" />
            New link (the old one stops)
          </button>
        )}
        {shared && (
          <div className="grid grid-cols-2 gap-2">
            {link && (
              <button type="button" onClick={() => void makeLink()} disabled={busy} className={cn(ROW, "bg-white/[0.07] text-foreground hover:bg-white/[0.11]")} title="A fresh link — whoever's on the old one is taken out">
                <ArrowClockwise size={15} weight="bold" />
                New link
              </button>
            )}
            <button type="button" onClick={() => void stop()} disabled={busy} className={cn(ROW, "bg-chili/15 text-chili-hi hover:bg-chili/25", !link && "col-span-2")}>
              <Stop size={13} weight="fill" />
              Stop sharing
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] text-chili-hi">{error}</p>}
    </div>
  );
}
