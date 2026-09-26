"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellRinging, Broadcast, Flag, ShieldStar } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import {
  GlassPopover,
  insideGlassPopover,
} from "@/components/ui/glass-popover";

/**
 * The bell: go-live pings for people you follow. Lives in the sidebar as a
 * nav-style row; the panel flies out beside it (or overlays on mobile).
 * Polls — notifications are glanceable, not real-time-critical, and a 30s
 * cadence matches the rest of the app's polling.
 */

interface NotificationRow {
  id: string;
  /**
   * live = someone you follow went live; reminder = a stream you asked
   * about started; mod_added = a creator made you a moderator; report = a
   * report for the queue (admins); takedown = your stream was taken down;
   * request_refunded = a paid request wasn't done and the money went back;
   * sponsor_paid = an Xtream campaign paid for a stream that ran its card.
   */
  type?:
    | "live"
    | "reminder"
    | "mod_added"
    | "report"
    | "takedown"
    | "battle_invite"
    | "battle_result"
    | "request_refunded"
    | "sponsor_paid"
    | "appeal"
    | "appeal_reversed"
    | "appeal_upheld";
  actorName: string;
  streamId: string | null;
  streamTitle: string;
  /** Where the row opens when it isn't a stream. */
  link?: string;
  read: boolean;
  createdAt: string;
}

/** What each kind of row says after its actor's name, and where it opens. */
function describe(n: NotificationRow) {
  switch (n.type) {
    case "reminder":
      return { verb: "just started the stream you asked about", detail: n.streamTitle };
    case "mod_added":
      return { verb: `made you a ${n.streamTitle || "moderator"} of their channel`, detail: "" };
    case "report":
      return { verb: "reported", detail: n.streamTitle };
    case "takedown":
      return { verb: "took down your stream after a report — you can appeal", detail: n.streamTitle };
    case "appeal":
      return { verb: "appealed a takedown", detail: n.streamTitle };
    case "appeal_reversed":
      return { verb: "reversed the takedown — your stream is back", detail: n.streamTitle };
    case "appeal_upheld":
      return { verb: "looked again and upheld the takedown", detail: n.streamTitle };
    case "request_refunded":
      return { verb: "didn't get to your request — it's refunded", detail: n.streamTitle };
    case "sponsor_paid":
      return { verb: "paid you for running their card", detail: n.streamTitle };
    default:
      return { verb: "went live", detail: n.streamTitle };
  }
}

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsBell({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { notifications: NotificationRow[]; unread: number };
        }>(`/api/user/me/notifications`);
        if (cancelled) return;
        setRows(res.data.notifications);
        setUnread(res.data.unread);
      } catch {
        // Endpoint unavailable — bell stays quiet.
      }
    }
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  // Close on outside click — the panel is portaled, so "inside" includes
  // any [data-glass-popover] surface, not just this component's subtree.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (insideGlassPopover(e.target)) return;
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = !open;
    if (next) setAnchor(e.currentTarget.getBoundingClientRect());
    setOpen(next);
    if (next && unread > 0) {
      // Opening acknowledges everything — badge clears now, the highlight
      // on each row survives until the panel closes.
      setUnread(0);
      void apiFetch(`/api/user/me/notifications/read`, {
        method: "POST",
      }).catch(() => {});
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggle}
        title={collapsed ? "Notifications" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-sm py-2.5 text-[16px] transition-colors",
          collapsed ? "justify-center px-0" : "px-3.5",
          open
            ? "bg-white/[0.07] font-semibold text-foreground"
            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
        )}
      >
        <span className="relative shrink-0">
          <Bell size={22} weight={open ? "fill" : "duotone"} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.55rem] font-bold text-primary-foreground ring-2 ring-sidebar tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        {!collapsed && "Notifications"}
      </button>

      {open && anchor && (
        <GlassPopover
          anchor={anchor}
          width={320}
          className="max-h-[70vh] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
        >
          <div className="border-b border-white/5 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              Notifications
            </p>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell size={28} className="mx-auto text-muted-foreground/20" />
              <p className="mt-2 text-xs text-muted-foreground/60">
                When streamers you&apos;re allied with go live, it shows up here.
              </p>
            </div>
          ) : (
            <div className="p-1.5">
              {rows.map((n) => (
                <Link
                  key={n.id}
                  href={n.link || (n.streamId && n.type !== "takedown" ? `/stream/${n.streamId}` : "/settings#chat")}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex items-start gap-2.5 rounded-sm px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]",
                    !n.read && "bg-primary/[0.06]"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
                      n.read
                        ? "bg-white/5 text-muted-foreground"
                        : "bg-primary/15 text-primary"
                    )}
                  >
                    {n.type === "reminder" ? (
                      <BellRinging size={14} weight="fill" />
                    ) : n.type === "mod_added" || n.type === "takedown" || n.type === "appeal" || n.type === "appeal_reversed" || n.type === "appeal_upheld" ? (
                      <ShieldStar size={14} weight="fill" />
                    ) : n.type === "report" ? (
                      <Flag size={14} weight="fill" />
                    ) : (
                      <Broadcast size={14} weight="fill" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-foreground/90">
                      <span className="font-semibold">{n.actorName}</span> {describe(n).verb}
                    </span>
                    {describe(n).detail && (
                      <span className="mt-0.5 block truncate text-[0.7rem] text-muted-foreground">
                        {describe(n).detail}
                      </span>
                    )}
                    <span className="mt-0.5 block text-[0.6rem] text-muted-foreground/50">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </GlassPopover>
      )}
    </div>
  );
}
