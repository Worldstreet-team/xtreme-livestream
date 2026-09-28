"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowClockwise, Broadcast, Eye, Microphone, MicrophoneSlash, Warning } from "@/components/icons";
import { Tip } from "@/components/ui/tip";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatNumber } from "@/lib/categories";
import { formatOnAir, liveActions, useLiveSession, type LiveSession } from "@/lib/live-session";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

export interface HeldStream {
  id: string;
  title: string;
  source: string;
  feedDroppedAt: string | null;
}

/**
 * A stream of yours that's live while this tab isn't running it: after a
 * reload (or a crash) it holds — viewers see "Be right back" — until you
 * pick it up; an encoder may still be feeding it; or it's on another device.
 * Only asked for when your account says you're live and nothing here is on
 * air, then again every half minute and whenever you come back to the tab.
 */
export function useHeldStream(): HeldStream | null {
  const { user } = useAuth();
  const session = useLiveSession();
  const pathname = usePathname();
  const [held, setHeld] = useState<HeldStream | null>(null);
  // The studio says it itself, with its own banner.
  const look = Boolean(user?.isLive) && !session && pathname !== "/studio";

  useEffect(() => {
    if (!look) return;
    let alive = true;
    const check = () => {
      apiFetch<{
        success: boolean;
        data: { stream: { id: string; title: string; source?: string; feedDroppedAt?: string | null } | null };
      }>("/api/streams/active/mine")
        .then((r) => {
          if (!alive) return;
          const s = r.data.stream;
          setHeld(s ? { id: s.id, title: s.title, source: s.source ?? "camera", feedDroppedAt: s.feedDroppedAt ?? null } : null);
        })
        .catch(() => {
          // Can't tell right now; the next look will.
        });
    };
    check();
    const t = setInterval(check, 30_000);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [look]);

  return look ? held : null;
}

/** What a held stream's card says, by why it's live without us. */
function heldCopy(held: HeldStream) {
  if (held.source === "obs") return { heading: "Your encoder is live", body: "Open the studio for chat, guests and gifts.", action: "Open studio" };
  if (held.feedDroppedAt) return { heading: "Your stream is on hold", body: "Viewers see “Be right back” until you pick it up.", action: "Resume" };
  return { heading: "Live on another device", body: "Move it here — the other one steps off as this one joins.", action: "Continue here" };
}

/**
 * Your broadcast, in the rail (wide screens): while you browse with the
 * studio minimized — the clock, who's watching, the mic, and the way back
 * in; while the connection heals, a way to get back on air now; and after
 * a reload, while the stream holds, one tap to resume it.
 */
export function LiveSessionCard({ collapsed }: { collapsed: boolean }) {
  const session = useLiveSession();
  const held = useHeldStream();
  const now = useNow(Boolean(session));

  if (session) return collapsed ? <LiveIcon session={session} now={now} /> : <LiveCard session={session} now={now} />;
  if (!held) return null;

  const copy = heldCopy(held);
  if (collapsed) {
    return (
      <Tip label={`${copy.heading} — ${copy.action.toLowerCase()}`} side="right">
        <Link
          href="/studio?resume=1"
          className="animate-rise press relative mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-chili/[0.16] text-chili-hi"
        >
          <Warning size={20} weight="fill" />
          <span className="sr-only">{copy.heading}</span>
        </Link>
      </Tip>
    );
  }
  return (
    <div className="animate-rise mb-3 rounded-[14px] bg-chili/[0.12] p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-chili-hi">
        <Warning size={15} weight="fill" className="shrink-0" />
        {copy.heading}
      </p>
      <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug font-semibold text-foreground">{held.title}</p>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{copy.body}</p>
      <Link
        href="/studio?resume=1"
        className="press mt-3 flex h-9 items-center justify-center gap-1.5 rounded-full bg-white text-[13px] font-semibold text-[#0b0708]"
      >
        <Broadcast size={14} weight="fill" />
        {copy.action}
      </Link>
    </div>
  );
}

function LiveCard({ session, now }: { session: LiveSession; now: number }) {
  const healing = session.state !== "live";
  return (
    <div className={cn("animate-rise mb-3 rounded-[14px] p-3 transition-colors", healing ? "bg-chili/[0.14]" : "bg-surface")}>
      <div className="flex items-center justify-between gap-2">
        {healing ? (
          <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-chili-hi">
            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {session.state === "rejoining" ? "Getting you back on" : "Reconnecting"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] font-bold tabular-nums">
            <span className="rounded-[5px] bg-chili px-1.5 py-px text-[10px] tracking-[0.06em] text-white">LIVE</span>
            <span className="font-mono text-foreground/85">{formatOnAir(session.startedAt, now)}</span>
          </span>
        )}
        <span className="flex items-center gap-1 text-[12px] text-muted-foreground tabular-nums">
          <Eye size={13} />
          {formatNumber(session.viewers)}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[13.5px] leading-snug font-semibold text-foreground">{session.title}</p>
      {healing && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">Viewers see “Be right back” until you’re back.</p>}
      <div className="mt-3 flex items-center gap-2">
        {session.state === "rejoining" ? (
          <button
            type="button"
            onClick={() => liveActions()?.reconnect()}
            className="press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white text-[13px] font-semibold text-[#0b0708]"
          >
            <ArrowClockwise size={14} weight="bold" />
            Retry now
          </button>
        ) : (
          <Link href="/studio" className="press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white text-[13px] font-semibold text-[#0b0708]">
            <Broadcast size={14} weight="fill" />
            Open studio
          </Link>
        )}
        <Tip label={session.micOn ? "Mute your mic" : "Unmute your mic"}>
          <button
            type="button"
            onClick={() => liveActions()?.toggleMic()}
            aria-label={session.micOn ? "Mute your mic" : "Unmute your mic"}
            className={cn(
              "press flex size-9 shrink-0 items-center justify-center rounded-full",
              session.micOn ? "bg-control text-foreground hover:bg-control-hover" : "bg-chili text-white"
            )}
          >
            {session.micOn ? <Microphone size={16} weight="fill" /> : <MicrophoneSlash size={16} weight="fill" />}
          </button>
        </Tip>
      </div>
    </div>
  );
}

/** The icon rail's version: one round button, LIVE under it — or, healing, a spinner. */
function LiveIcon({ session, now }: { session: LiveSession; now: number }) {
  const healing = session.state !== "live";
  const label = healing ? "Reconnecting — open the studio" : `You're live · ${formatOnAir(session.startedAt, now)} — open the studio`;
  return (
    <Tip label={healing ? "Reconnecting — open the studio" : "You're live — open the studio"} side="right">
      <Link href="/studio" className="animate-rise press relative mx-auto mb-3 flex flex-col items-center gap-1">
        <span className={cn("flex size-11 items-center justify-center rounded-full", healing ? "bg-chili/[0.16] text-chili-hi" : "bg-chili text-white")}>
          {healing ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Broadcast size={20} weight="fill" />}
        </span>
        <span className="font-mono text-[10px] font-bold text-foreground/80 tabular-nums">{healing ? "…" : formatOnAir(session.startedAt, now)}</span>
        <span className="sr-only">{label}</span>
      </Link>
    </Tip>
  );
}

/**
 * The phone's version of the held card — the minimized player covers the
 * live case — a pill above the tab bar: your stream is on hold, resume it.
 */
export function HeldStreamPill({ held }: { held: HeldStream | null }) {
  // The shell asks once and shares the answer with the Go live button, which steps aside for this.
  if (!held) return null;
  const copy = heldCopy(held);
  return (
    <Link
      href="/studio?resume=1"
      className="press fixed inset-x-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+0.75rem)] z-40 flex items-center gap-2.5 rounded-full bg-chili py-2 pr-2 pl-3.5 text-white shadow-[0_12px_28px_rgba(0,0,0,0.45)] motion-safe:animate-[pop-in_320ms_var(--ease-spring)_both] md:hidden"
    >
      <Warning size={16} weight="fill" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{copy.heading}</span>
      <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[12.5px] font-bold text-[#0b0708]">{copy.action}</span>
    </Link>
  );
}
