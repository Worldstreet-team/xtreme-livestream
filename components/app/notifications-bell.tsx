"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Broadcast } from "@phosphor-icons/react";
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
  actorName: string;
  streamId: string;
  streamTitle: string;
  read: boolean;
  createdAt: string;
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
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          collapsed && "justify-center px-0",
          open
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <span className="relative shrink-0">
          <Bell size={18} weight={open ? "fill" : "regular"} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.55rem] font-bold text-primary-foreground ring-2 ring-[oklch(0.12_0.005_285)] tabular-nums">
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
                When streamers you follow go live, it shows up here.
              </p>
            </div>
          ) : (
            <div className="p-1.5">
              {rows.map((n) => (
                <Link
                  key={n.id}
                  href={`/stream/${n.streamId}`}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]",
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
                    <Broadcast size={14} weight="fill" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-foreground/90">
                      <span className="font-semibold">{n.actorName}</span> went
                      live
                    </span>
                    {n.streamTitle && (
                      <span className="mt-0.5 block truncate text-[0.7rem] text-muted-foreground">
                        {n.streamTitle}
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
