"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellRinging,
  Broadcast,
  Coins,
  Flag,
  ShieldStar,
  Sword,
  Trophy,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { BACKSTOP_QUIET_MS, useXtreamPoll } from "@/lib/xtream-live-events";
import { staggerDelay } from "@/lib/motion";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Empty } from "@/components/app/empty";
import { UnfoldWindow, unfoldRow } from "@/components/app/unfold-window";
import { Tip } from "@/components/ui/tip";

/**
 * The bell in the top bar, and the window it opens: go-live pings for
 * people you follow, battle invites and results, money back, safety news.
 * On a computer the window unfolds out of the bell; on a phone it slides in
 * from the right (components/app/unfold-window.tsx has the why).
 *
 * Polls — notifications are glanceable, not real-time-critical, and a 30s
 * cadence matches the rest of the app's polling. Opening the window marks
 * everything read: the badge clears at once, and each row keeps its unread
 * emphasis until the window closes, so you can still see what was new.
 */

type NotificationType =
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

interface NotificationRow {
  id: string;
  /**
   * live = someone you follow went live; reminder = a stream you asked
   * about started; mod_added = a creator made you a moderator; report = a
   * report for the queue (admins); takedown = your stream was taken down;
   * request_refunded = a paid request wasn't done and the money went back;
   * sponsor_paid = an Xtream campaign paid for a stream that ran its card.
   */
  type?: NotificationType;
  actorName: string;
  /** The person's handle and face, when they still exist. */
  actorUsername?: string;
  actorAvatar?: string;
  streamId: string | null;
  streamTitle: string;
  /** Where the row opens when it isn't a stream. */
  link?: string;
  read: boolean;
  createdAt: string;
}

/** What each kind of row says after its actor's name. */
function describe(n: NotificationRow) {
  switch (n.type) {
    case "reminder":
      return { verb: "just started the stream you asked about", detail: n.streamTitle };
    case "battle_invite":
      return { verb: "challenged you to a battle", detail: n.streamTitle };
    case "battle_result":
      return { verb: "— your battle is over, see how it went", detail: n.streamTitle };
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

/**
 * The small mark on each face that says what kind of row it is. Heat only
 * where the Afterglow rules allow it — Chili for live, Ember for a battle —
 * gold for money, and quiet neutrals for the rest.
 */
function glyph(type: NotificationType | undefined) {
  switch (type) {
    case "reminder":
      return { icon: BellRinging, tone: "bg-chili text-white" };
    case "battle_invite":
      return { icon: Sword, tone: "bg-ember text-on-ember" };
    case "battle_result":
      return { icon: Trophy, tone: "bg-ember text-on-ember" };
    case "request_refunded":
    case "sponsor_paid":
      return { icon: Coins, tone: "bg-tone-amber text-value" };
    case "report":
      return { icon: Flag, tone: "bg-tone-red text-chili-hi" };
    case "mod_added":
    case "takedown":
    case "appeal":
    case "appeal_reversed":
    case "appeal_upheld":
      return { icon: ShieldStar, tone: "bg-control text-foreground" };
    default:
      return { icon: Broadcast, tone: "bg-chili text-white" };
  }
}

function hrefFor(n: NotificationRow) {
  return n.link || (n.streamId && n.type !== "takedown" ? `/stream/${n.streamId}` : "/settings#chat");
}

const POLL_MS = 30_000;
const NOTIFICATION_PUSHES = ["notification"] as const;

function timeAgo(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/** Today's rows, then the rest — by the viewer's own calendar day. */
function groupByDay(rows: NotificationRow[], now: number) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = rows.filter((n) => new Date(n.createdAt).getTime() >= midnight.getTime());
  const earlier = rows.filter((n) => new Date(n.createdAt).getTime() < midnight.getTime());
  return [
    { label: "Today", rows: today },
    { label: "Earlier", rows: earlier },
  ].filter((g) => g.rows.length > 0);
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
  const [openedAt, setOpenedAt] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // A new row is pushed the moment it's written; the poll is the backstop.
  const { pace, tick } = useXtreamPoll(POLL_MS, BACKSTOP_QUIET_MS, NOTIFICATION_PUSHES);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { notifications: NotificationRow[]; unread: number; avatars?: Record<string, string> };
        }>(`/api/user/me/notifications`);
        if (cancelled) return;
        // Faces come once per poll, by username; each row picks its own up.
        const avatars = res.data.avatars ?? {};
        setRows(res.data.notifications.map((n) => ({ ...n, actorAvatar: n.actorUsername ? avatars[n.actorUsername] : undefined })));
        setUnread(res.data.unread);
      } catch {
        // Endpoint unavailable — bell stays quiet.
      }
    }
    void load();
    const timer = setInterval(() => void load(), pace);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, pace, tick]);

  const close = () => {
    setOpen(false);
    // What was new has been seen: the emphasis goes with the window.
    setRows((r) => (r.some((n) => !n.read) ? r.map((n) => ({ ...n, read: true })) : r));
  };

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) return close();
    setAnchor(e.currentTarget.getBoundingClientRect());
    setOpenedAt(Date.now());
    setOpen(true);
    if (unread > 0) {
      // Opening acknowledges everything — badge clears now, the highlight
      // on each row survives until the window closes.
      setUnread(0);
      void apiFetch(`/api/user/me/notifications/read`, {
        method: "POST",
      }).catch(() => {});
    }
  };

  if (!user) return null;

  const fresh = rows.filter((n) => !n.read).length;
  let index = 0;

  return (
    <div className="relative">
      <Tip label={unread > 0 ? `Notifications · ${unread} new` : "Notifications"} side="bottom" disabled={!collapsed || open}>
      <button
        ref={buttonRef}
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-sm py-2.5 text-[16px] transition-colors",
          collapsed ? "justify-center px-0" : "px-3.5",
          open
            ? "bg-tint/[0.07] font-semibold text-foreground"
            : "text-muted-foreground hover:bg-tint/[0.04] hover:text-foreground"
        )}
      >
        <span className="relative shrink-0">
          <Bell size={22} weight={open ? "fill" : "duotone"} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-chili text-[0.55rem] font-bold text-white ring-2 ring-background tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        {!collapsed && "Notifications"}
      </button>
      </Tip>

      <UnfoldWindow
        open={open}
        onClose={close}
        anchor={anchor}
        triggerRef={buttonRef}
        width={380}
        label="Notifications"
        title="Notifications"
        aside={
          fresh > 0 ? (
            <span className="shrink-0 text-[12px] font-semibold text-ember-hi tabular-nums">{fresh} new</span>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <Empty
            scene="notifications"
            compact
            title="Nothing yet"
            body="When channels you're allied with go live, or someone challenges you, it lands here."
            onNavigate={close}
          />
        ) : (
          <div className="px-2 pt-1 pb-2">
            {groupByDay(rows, openedAt).map((group) => {
              const head = unfoldRow(staggerDelay(index++));
              return (
              <section key={group.label} aria-label={group.label}>
                <h3 className={cn(head.className, "px-2.5 pt-3 pb-1.5 text-[11.5px] font-semibold tracking-[0.02em] text-muted-foreground")} style={head.style}>
                  {group.label}
                </h3>
                <ul className="flex flex-col gap-px">
                  {group.rows.map((n) => {
                    const { verb, detail } = describe(n);
                    const { icon: Glyph, tone } = glyph(n.type);
                    const row = unfoldRow(staggerDelay(index++));
                    return (
                      <li key={n.id} className={row.className} style={row.style}>
                        <Link
                          href={hrefFor(n)}
                          onClick={() => {
                            close();
                            onNavigate?.();
                          }}
                          className={cn(
                            "group/row relative flex items-start gap-3 rounded-control px-2.5 py-2.5 transition-colors hover:bg-tint/[0.05] focus-visible:bg-tint/[0.05] focus-visible:outline-none",
                            !n.read && "bg-tint/[0.035]",
                          )}
                        >
                          <span className="relative mt-0.5 shrink-0">
                            <UserAvatar src={n.actorAvatar ?? ""} name={n.actorName} size={40} className="size-10" />
                            <span className={cn("absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-popover", tone)}>
                              <Glyph size={10} weight="fill" />
                            </span>
                          </span>
                          <span className="min-w-0 flex-1 pr-3">
                            <span className={cn("line-clamp-2 text-[13.5px] leading-snug", n.read ? "text-muted-foreground" : "text-foreground")}>
                              <span className={cn("font-semibold", n.read ? "text-foreground/85" : "text-foreground")}>{n.actorName}</span> {verb}
                            </span>
                            {detail && (
                              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{detail}</span>
                            )}
                          </span>
                          <span className="mt-0.5 flex shrink-0 flex-col items-end gap-1.5">
                            <time dateTime={n.createdAt} className={cn("text-[11.5px] tabular-nums", n.read ? "text-muted-foreground/70" : "font-semibold text-ember-hi")}>
                              {timeAgo(n.createdAt, openedAt)}
                            </time>
                            {!n.read && <span className="size-2 rounded-full bg-ember" aria-label="New" />}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
              );
            })}
          </div>
        )}
      </UnfoldWindow>
    </div>
  );
}
