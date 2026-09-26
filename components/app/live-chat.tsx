"use client";

import { SIGN_IN_URL } from "@/lib/auth-urls";
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChatCircleDots,
  Clock,
  Flag,
  Gift,
  MonitorPlay,
  Prohibit,
  PushPin,
  ShieldStar,
  SignIn,
  Smiley,
  Timer,
  Trash,
  X,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api-client";
import { GIFT_MAX_MINOR, GIFT_MIN_MINOR, REQUEST_GIFT, centsToDollars, type GiftDef } from "@/lib/gifts";
import { GiftKeyboard, type GiftTab } from "@/components/app/gift-keyboard";
import { GiftArt } from "@/components/app/gift-art";
import { foldLines, giftUnit, isDrop, isShout, mentions, readFan, type ChatMsg, type ChatPlatform, type FanStanding } from "@/components/app/chat/lines";
import { ShoutRail } from "@/components/app/chat/shout-rail";
import { useViewerRequests, type RequestOrder } from "@/lib/requests";
import { serverNow } from "@/lib/server-clock";
import { useFeaturedShowing } from "@/lib/use-featured";
import type { FeaturedItem } from "@/lib/scene";
import type { ChannelRole, ModsCanFeature } from "@xtreme/contracts";
import { HeldQueue, type HeldLine } from "@/components/app/chat/held-queue";
import { ReportMenu } from "@/components/app/chat/report-menu";
import {
  ArrivalTicker,
  Badges,
  DropsLine,
  GiftLine,
  MessageLine,
  StageLine,
  TopGiftersBar,
  type ChatSkin,
  type Supporter,
  type TopFan,
} from "@/components/app/chat/chat-lines";
import type { Room } from "livekit-client";

const SLOW_MODE_SECONDS = 30;
/** What chat keeps in memory: enough to scroll back through, not a whole stream's worth. */
const MAX_MESSAGES = 250;
/** What the lane over the video draws — a lane, not a log. */
const OVERLAY_LINES = 30;
/** How long an arrival stays on the ticker without another behind it. */
const ARRIVAL_MS = 4000;

const QUICK_REACTIONS = ["🔥", "🚀", "💎", "🙌", "💰", "📈", "📉", "🐻", "🐂", "😂"];

export interface PinnedMessage {
  messageId: string;
  username: string;
  avatar: string;
  content: string;
}

export type { Supporter as ChatSupporter };

interface LiveChatProps {
  streamId: string;
  room: Room | null;
  isLive: boolean;
  /** The host's own chat: moderation tools, no gift button. */
  isHost?: boolean;
  /**
   * A producer's console (producer mode): the crew's chat — no gifts or
   * paid requests, and what's on screen marked as in the host's. Their
   * role comes from the room as anyone's does.
   */
  crew?: boolean;
  /** Pin persisted on the stream doc, so late joiners see it. */
  initialPinned?: PinnedMessage | null;
  /**
   * "panel": the desktop column. "overlay": the lane over the video on a
   * phone. "sheet": the studio's phone drawer. One component, one set of
   * state and handlers; only the skin changes.
   */
  variant?: "panel" | "overlay" | "sheet";
  /** Overlay only: rendered between the messages and the composer — the
   *  studio puts its control dock here so it sits inside the same band. */
  beforeComposer?: ReactNode;
  /** The room's top gifters, richest first: ranked beside their names, and
   *  leading the panel. */
  topGifters?: Supporter[];
  /** This stream's top fans — watch time and chat count, not only gifts. */
  topFans?: TopFan[];
  /** Where I stand with the channel, signed in. */
  myFan?: FanStanding | null;
  /** The host's username, so their lines wear a Host badge. */
  hostUsername?: string;
  /** Host: what's on screen now — its line is marked, and its tool takes it down. */
  featured?: FeaturedItem | null;
  /** Host: how long a line goes up for, in seconds; 0 is until taken down. */
  featureSeconds?: number;
  /** Host: the scene the API answered with, so the studio shows it at once. */
  onScene?: (scene: unknown) => void;
  /** Host: the lines moderators suggested for the screen, as they change. */
  onFeatureQueue?: (queue: unknown) => void;
}

/** The room's rules as this viewer meets them (GET /streams/:id/role, then room events). */
interface RoomRules {
  role: ChannelRole | null;
  shield: boolean;
  modsCanFeature?: ModsCanFeature;
}

/** A held line off the wire. */
function toHeldLine(raw: Record<string, unknown>): HeldLine {
  return {
    id: String(raw.id),
    userId: raw.userId ? String(raw.userId) : undefined,
    username: String(raw.username ?? ""),
    avatar: String(raw.avatar ?? ""),
    content: String(raw.content ?? ""),
    type: "text",
    at: typeof raw.at === "number" ? raw.at : Date.now(),
    heldLabel: String(raw.heldLabel ?? "Held"),
  };
}

/**
 * Live chat, rewritten 2026-09-25 (owner: "i need the chat… totally
 * rewritten, use another style for the flow including the top gifters…
 * make it more real").
 *
 * The flow is modelled on how people actually read a live room:
 * - Talk and gifts are the conversation. Arrivals are a ticker ("tolu and
 *   4 others joined"), not a row each; likes are hearts on the player, not
 *   rows at all. Runs of drops and repeated gifts fold into one line.
 * - Reading back pauses the scroll: new lines collect behind a "new
 *   messages" pill instead of yanking you to the bottom.
 * - Top gifters wear their rank beside their name; the host wears Host.
 * - Memory is capped; the lane over video only draws its last few lines.
 *
 * Sending still persists first, then shows: a message the server refuses
 * (slow mode, a ban) never appears to have gone through.
 */
export function LiveChat({
  streamId,
  room,
  isLive,
  isHost = false,
  crew = false,
  initialPinned = null,
  variant = "panel",
  beforeComposer,
  topGifters,
  topFans,
  myFan = null,
  hostUsername,
  featured = null,
  featureSeconds = 20,
  onScene,
  onFeatureQueue,
}: LiveChatProps) {
  const skin: ChatSkin = variant === "overlay" ? "overlay" : "panel";
  const overlay = skin === "overlay";
  const chrome = variant === "panel";
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [arrival, setArrival] = useState<{ name: string; others: number; key: number; at: number } | null>(null);
  const [input, setInput] = useState("");
  const [showReactions, setShowReactions] = useState(false);
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  /** Which tab the gift sheet opens on — the requests chip opens it on the menu. */
  const [giftTab, setGiftTab] = useState<GiftTab>("gifts");
  /** Shouts, for the pinned rail: kept apart from the lines, since an hour's pin outlives them. */
  const [shouts, setShouts] = useState<ChatMsg[]>([]);
  const [giftBusy, setGiftBusy] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);
  /** Spendable wallet balance in USD cents; null until loaded (or unavailable). */
  const [walletMinor, setWalletMinor] = useState<number | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [slowMode, setSlowMode] = useState(false);
  const [showModTools, setShowModTools] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [sending, setSending] = useState(false);
  /** Why the last send was rejected (slow mode, followers-only, offline...). */
  const [chatError, setChatError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<PinnedMessage | null>(initialPinned);
  /** Set when *I* am the one banned — locks the composer. */
  const [myBan, setMyBan] = useState<{ until: string | null } | null>(null);
  /** Line whose host tools are open (tap-friendly, not hover-only). */
  const [modMenuFor, setModMenuFor] = useState<string | null>(null);
  const [modBusy, setModBusy] = useState(false);
  /** Reading back: the scroll stays put and new lines are counted instead. */
  const [paused, setPaused] = useState(false);
  const [unseen, setUnseen] = useState(0);
  /** Who I am in this room, and whether Shield is up. The studio's host is the host outright. */
  const [rules, setRules] = useState<RoomRules>({ role: null, shield: false });
  const role: ChannelRole | null = isHost ? "host" : rules.role;
  const canModerate = role !== null;
  /** What the filter is holding — moderators only. */
  const [held, setHeld] = useState<HeldLine[]>([]);
  /** Moderators: accounts that look like ones banned here lately, and why (safety/evasion.ts). */
  const [suspects, setSuspects] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [heldBusy, setHeldBusy] = useState<string | null>(null);
  /** My own held lines, so their outcome can be told to me. */
  const pendingIdsRef = useRef<Set<string>>(new Set());
  /** The line whose report menu is open. */
  const [reportFor, setReportFor] = useState<string | null>(null);
  /** A passing confirmation ("Suggested to the host"). */
  const [notice, setNotice] = useState<string | null>(null);
  // Paid requests: the host's menu while they're taking them, and mine.
  const onRequestNews = useCallback(
    (order: RequestOrder) => {
      const who = hostUsername ?? "The host";
      setNotice(
        order.status === "done"
          ? `Done: ${order.title} — ${who} got to it`
          : `${order.title} wasn't done — ${centsToDollars(order.priceUsdMinor)} ${order.refunded ? "is back in your wallet" : "is on its way back"}`
      );
    },
    [hostUsername]
  );
  const requests = useViewerRequests(streamId, isHost || crew ? null : room, Boolean(user) && !isHost && !crew, onRequestNews);
  const onFeatureQueueRef = useRef(onFeatureQueue);
  useEffect(() => {
    onFeatureQueueRef.current = onFeatureQueue;
  }, [onFeatureQueue]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  // Ids already drawn — the local echo and the server's room broadcast of
  // the same persisted message must not both appear.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);
  /** Lines appended since the scroll last caught up. */
  const appendedRef = useRef(0);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The battle bar's "Back this side" opens the same gift panel from outside
  // the chat column, so backing a side is one tap from the player.
  useEffect(() => {
    const open = () => {
      setGiftTab("gifts");
      setShowGiftPanel(true);
    };
    window.addEventListener("xtreme:open-gifts", open);
    return () => window.removeEventListener("xtreme:open-gifts", open);
  }, []);

  // The room's rules — my role, Shield, slow mode — for everyone, signed in or not.
  useEffect(() => {
    if (!streamId) return;
    let cancelled = false;
    apiFetch<{
      success: boolean;
      data: { role: ChannelRole | null; shield: boolean; slowMode: boolean; modsCanFeature?: ModsCanFeature };
    }>(`/api/streams/${streamId}/role`)
      .then((r) => {
        if (cancelled) return;
        setRules({ role: r.data.role, shield: r.data.shield, modsCanFeature: r.data.modsCanFeature });
        setSlowMode(r.data.slowMode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId, user?.id]);

  // Moderators: what's already waiting when they open the chat.
  useEffect(() => {
    if (!streamId || !canModerate) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { held: Record<string, unknown>[] } }>(`/api/streams/${streamId}/chat/held`)
      .then((r) => {
        if (!cancelled) setHeld(r.data.held.map(toHeldLine));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId, canModerate]);

  // A passing confirmation clears itself.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // Countdown while a slow-mode cooldown is running.
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setTimeout(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownLeft]);

  /** Add what's new, skip what's already drawn, keep the last MAX_MESSAGES. */
  const append = useCallback((incoming: ChatMsg[]) => {
    const fresh = incoming.filter((m) => !seenIdsRef.current.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) seenIdsRef.current.add(m.id);
    appendedRef.current += fresh.length;
    setMessages((prev) => [...prev, ...fresh].slice(-MAX_MESSAGES));
  }, []);

  /** A Shout still pinned joins the rail (once); the ones whose pin ran out leave it. */
  const pinShouts = useCallback((incoming: ChatMsg[]) => {
    const live = incoming.filter((m) => isShout(m) && Date.parse(m.shoutUntil!) > serverNow());
    if (live.length === 0) return;
    setShouts((prev) => {
      const now = serverNow();
      const kept = prev.filter((p) => Date.parse(p.shoutUntil!) > now && !live.some((m) => m.id === p.id));
      return [...kept, ...live].slice(-20);
    });
  }, []);

  /** An arrival joins the ticker; a quiet spell clears it. */
  const noteArrival = useCallback((name: string) => {
    const now = Date.now();
    setArrival((prev) =>
      prev && now - prev.at < ARRIVAL_MS
        ? { name, others: prev.others + 1, key: prev.key, at: now }
        : { name, others: 0, key: now, at: now }
    );
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    arrivalTimerRef.current = setTimeout(() => setArrival(null), ARRIVAL_MS);
  }, []);

  useEffect(
    () => () => {
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    },
    []
  );

  // History from the API, merged under anything the room delivered first.
  useEffect(() => {
    if (!streamId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            messages: Array<{
              _id: string;
              userId?: string;
              username: string;
              avatar: string;
              isMod?: boolean;
              platform?: ChatPlatform;
              content: string;
              type: "text" | "tip" | "reaction";
              tipAmount?: string;
              tipCurrency?: string;
              emoji?: string;
              createdAt: string;
              fan?: unknown;
              shoutUntil?: string | null;
            }>;
            shouts?: Array<Record<string, unknown>>;
          };
        }>(`/api/streams/${streamId}/chat`);
        if (cancelled) return;
        const history: ChatMsg[] = res.data.messages.map((m) => ({
          id: m._id,
          userId: m.userId ? String(m.userId) : undefined,
          username: m.username,
          avatar: m.avatar,
          isMod: m.isMod,
          platform: m.platform,
          content: m.content,
          type: m.type,
          tipAmount: m.tipAmount,
          tipCurrency: m.tipCurrency,
          emoji: m.emoji,
          at: new Date(m.createdAt).getTime(),
          fan: readFan(m.fan),
          ...(m.shoutUntil ? { shoutUntil: m.shoutUntil } : {}),
        }));
        // Every Shout still pinned, however far back it was sent.
        pinShouts(
          (res.data.shouts ?? []).map((m) => ({
            id: String(m._id),
            userId: m.userId ? String(m.userId) : undefined,
            username: String(m.username ?? ""),
            avatar: String(m.avatar ?? ""),
            content: String(m.content ?? ""),
            type: "tip" as const,
            tipAmount: typeof m.tipAmount === "string" ? m.tipAmount : undefined,
            tipCurrency: "USD",
            emoji: typeof m.emoji === "string" ? m.emoji : undefined,
            at: new Date(String(m.createdAt)).getTime(),
            shoutUntil: typeof m.shoutUntil === "string" ? m.shoutUntil : undefined,
          }))
        );
        const ids = new Set(history.map((h) => h.id));
        for (const id of ids) seenIdsRef.current.add(id);
        setMessages((prev) => [...history, ...prev.filter((p) => !ids.has(p.id))].slice(-MAX_MESSAGES));
      } catch {
        // No history — the live room still fills the chat.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streamId, pinShouts]);

  // The room: chat, gifts and the events that shape the chat.
  useEffect(() => {
    if (!room || attachedRef.current) return;
    attachedRef.current = true;

    let eventName: string | undefined;

    const setup = async () => {
      const { RoomEvent } = await import("livekit-client");
      eventName = RoomEvent.DataReceived;

      const handleData = (payload: Uint8Array, participant?: { identity: string }) => {
        if (participant?.identity === user?.id) return;
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as Partial<ChatMsg> & {
            __evt?: string;
            enabled?: boolean;
            on?: boolean;
            role?: ChannelRole | null;
            outcome?: "approved" | "denied";
            queue?: unknown;
            messageId?: string;
            until?: string | null;
            message?: PinnedMessage;
            action?: string;
          };

          if (data.__evt) {
            switch (data.__evt) {
              case "slowmode":
                setSlowMode(!!data.enabled);
                return;
              case "shield":
                setRules((r) => ({ ...r, shield: !!data.on }));
                return;
              // Made (or unmade) a moderator while watching: the tools follow at once.
              case "role":
                setRules((r) => ({ ...r, role: data.role ?? null }));
                return;
              // Moderators: an account that looks like one banned here lately.
              case "suspect": {
                const d = data as { userId?: string; reason?: string };
                if (d.userId && d.reason) setSuspects((cur) => new Map(cur).set(d.userId!, d.reason!));
                return;
              }
              // Moderators: a line the filter caught.
              case "held": {
                const line = toHeldLine(data.message as unknown as Record<string, unknown>);
                setHeld((h) => (h.some((x) => x.id === line.id) ? h : [...h, line]));
                return;
              }
              // Let in or kept out — off every moderator's queue; and if it
              // was mine, I hear which.
              case "held_resolved": {
                const id = data.messageId;
                if (!id) return;
                setHeld((h) => h.filter((x) => x.id !== id));
                if (pendingIdsRef.current.has(id)) {
                  pendingIdsRef.current.delete(id);
                  if (data.outcome === "approved") {
                    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, pending: false } : m)));
                  } else {
                    setMessages((prev) => prev.filter((m) => m.id !== id));
                    setChatError("A moderator didn't let your message through.");
                  }
                }
                return;
              }
              case "feature_queue":
                onFeatureQueueRef.current?.(data.queue);
                return;
              // A deleted message vanishes for everyone at once — and from the held queue.
              case "chat_delete":
                if (data.messageId) {
                  setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
                  setHeld((h) => h.filter((x) => x.id !== data.messageId));
                  setShouts((prev) => prev.filter((m) => m.id !== data.messageId));
                }
                return;
              // A ban wipes that user's lines everywhere; the banned client
              // also locks its own composer.
              case "chat_ban":
                if (data.userId) {
                  setMessages((prev) => prev.filter((m) => m.userId !== data.userId));
                  setShouts((prev) => prev.filter((m) => m.userId !== data.userId));
                  if (data.userId === user?.id) setMyBan({ until: data.until ?? null });
                }
                return;
              case "chat_unban":
                if (data.userId === user?.id) setMyBan(null);
                return;
              case "pin":
                if (data.message) setPinned(data.message);
                return;
              case "unpin":
                setPinned(null);
                return;
              // Arrivals are a ticker; likes are the player's hearts.
              case "join":
                if (data.username) noteArrival(data.username);
                return;
              case "like":
                return;
              // Stage transitions read like the room's own news — "X joined
              // the stage" is half the reason to tap Join yourself.
              case "guest_update": {
                const verb =
                  data.action === "approved"
                    ? "joined the stage"
                    : data.action === "left"
                      ? "left the stage"
                      : data.action === "removed"
                        ? "was removed from the stage"
                        : null;
                if (verb && data.username) {
                  append([
                    {
                      id: `stage-${data.username}-${data.action}-${Date.now()}`,
                      username: data.username,
                      avatar: "",
                      content: verb,
                      type: "stage",
                      at: Date.now(),
                    },
                  ]);
                }
                return;
              }
              default:
                return;
            }
          }

          if (!data.username || !data.type) return;
          const line: ChatMsg = {
              id: String(data.id ?? `rt-${Date.now()}-${Math.random()}`),
              userId: data.userId,
              username: data.username,
              avatar: data.avatar ?? "",
              isMod: data.isMod,
              platform: data.platform,
              content: data.content ?? "",
              type: data.type,
              tipAmount: data.tipAmount,
              tipCurrency: data.tipCurrency,
              emoji: data.emoji,
              at: Date.now(),
              fan: readFan((data as { fan?: unknown }).fan),
              ...(typeof data.shoutUntil === "string" ? { shoutUntil: data.shoutUntil } : {}),
          };
          append([line]);
          pinShouts([line]);
        } catch {
          // Not a chat payload.
        }
      };

      room.on(RoomEvent.DataReceived, handleData);
      (room as unknown as Record<string, unknown>).__chatHandler = handleData;
    };

    setup();

    return () => {
      if (eventName && room) {
        const handler = (room as unknown as Record<string, unknown>).__chatHandler;
        if (handler) room.off(eventName as Parameters<typeof room.off>[0], handler as Parameters<typeof room.off>[1]);
      }
      attachedRef.current = false;
    };
  }, [room, user?.id, append, noteArrival, pinShouts]);

  // Follow the bottom — unless the reader has scrolled up, in which case
  // the new lines are counted for the pill instead.
  useEffect(() => {
    const added = appendedRef.current;
    appendedRef.current = 0;
    const el = scrollRef.current;
    if (!el) return;
    if (pausedRef.current) {
      if (added > 0) setUnseen((u) => u + added);
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (pausedRef.current === atBottom) {
      pausedRef.current = !atBottom;
      setPaused(!atBottom);
    }
    if (atBottom) setUnseen(0);
  };

  const jumpToLatest = () => {
    pausedRef.current = false;
    setPaused(false);
    setUnseen(0);
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // Host and moderators: slow mode for the room — the API keeps it on the
  // channel and tells everyone.
  const toggleSlowMode = useCallback(
    async (enabled: boolean) => {
      setSlowMode(enabled);
      try {
        await apiFetch(`/api/streams/${streamId}/slowmode`, { method: "POST", body: JSON.stringify({ enabled }) });
      } catch {
        setSlowMode(!enabled);
      }
    },
    [streamId]
  );

  // Host and lead moderators: Shield — allies only, slow mode, links and
  // scams blocked, new accounts held.
  const toggleShield = async (on: boolean) => {
    setRules((r) => ({ ...r, shield: on }));
    try {
      await apiFetch(`/api/streams/${streamId}/shield`, { method: "POST", body: JSON.stringify({ on }) });
    } catch (err) {
      setRules((r) => ({ ...r, shield: !on }));
      setChatError(err instanceof Error ? err.message : "Couldn't change Shield");
    }
  };

  // Moderators: decide on a held line.
  const decideHeld = async (id: string, letIn: boolean) => {
    setHeldBusy(id);
    try {
      await apiFetch(letIn ? `/api/streams/${streamId}/chat/${id}/approve` : `/api/streams/${streamId}/chat/${id}`, {
        method: letIn ? "POST" : "DELETE",
      });
      setHeld((h) => h.filter((x) => x.id !== id));
    } catch {
      // Another moderator may have decided first; the event will tidy up.
    } finally {
      setHeldBusy(null);
    }
  };

  /**
   * Persist first, then show. The API fans the saved message into the room
   * itself, so a message it refuses (slow mode, followers-only, a ban)
   * never reaches anyone — and the sender sees why.
   */
  const submitMessage = async (msg: Omit<ChatMsg, "id" | "at">, body: Record<string, unknown>) => {
    setChatError(null);
    let savedId: string | null = null;
    let heldForReview = false;
    let fan: ChatMsg["fan"];
    try {
      const saved = await apiFetch<{ success: boolean; data: { message: { _id: string }; held?: boolean; fan?: unknown } }>(
        `/api/streams/${streamId}/chat`,
        { method: "POST", body: JSON.stringify(body) }
      );
      savedId = saved?.data?.message?._id ?? null;
      heldForReview = Boolean(saved?.data?.held);
      // My own standing, so my line wears my badge like everyone else's.
      fan = readFan(saved?.data?.fan);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Couldn't send that message.");
      // Slow mode: start the countdown so the input says so.
      if (err instanceof ApiError && err.status === 429) setCooldownLeft(SLOW_MODE_SECONDS);
      // BANNED locks the composer — the ban event usually beats this here.
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        err.data &&
        typeof err.data === "object" &&
        (err.data as { code?: string }).code === "BANNED"
      ) {
        setMyBan({ until: null });
      }
      return false;
    }
    // The saved id, so the room's broadcast of this same message dedupes.
    const id = savedId ?? `local-${Date.now()}`;
    append([{ ...msg, id, at: Date.now(), ...(fan ? { fan } : {}), ...(heldForReview ? { pending: true } : {}) }]);
    if (heldForReview) pendingIdsRef.current.add(id);
    // Sending is also "I want to see the latest".
    pausedRef.current = false;
    setPaused(false);
    setUnseen(0);
    return true;
  };

  // ---- Host moderation ----
  // The API fans the matching event into the room, which is what changes
  // every client's view; these only tidy the host's own view at once.

  const modDeleteMessage = async (messageId: string) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      await apiFetch(`/api/streams/${streamId}/chat/${messageId}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch {
      // The line stays; the host can retry.
    } finally {
      setModBusy(false);
      setModMenuFor(null);
    }
  };

  const modBanUser = async (targetId: string, minutes?: number) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      await apiFetch(`/api/streams/${streamId}/ban/${targetId}`, {
        method: "POST",
        body: JSON.stringify(minutes ? { minutes } : {}),
      });
      setMessages((prev) => prev.filter((m) => m.userId !== targetId));
    } catch {
      // The ban failed — the lines stay.
    } finally {
      setModBusy(false);
      setModMenuFor(null);
    }
  };

  const modPinMessage = async (messageId: string) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      await apiFetch(`/api/streams/${streamId}/chat/${messageId}/pin`, { method: "POST" });
      const msg = messages.find((m) => m.id === messageId);
      if (msg) setPinned({ messageId, username: msg.username, avatar: msg.avatar, content: msg.content });
    } catch {
      // Pin failed — the banner stays as it was.
    } finally {
      setModBusy(false);
      setModMenuFor(null);
    }
  };

  /** Put a line or gift on screen; the room redraws from the scene the API writes. */
  const modFeature = async (messageId: string) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { scene?: unknown; suggested?: boolean } }>(
        `/api/streams/${streamId}/chat/${messageId}/feature`,
        { method: "POST", body: JSON.stringify({ seconds: featureSeconds || null }) }
      );
      if (res.data.suggested) setNotice("Suggested to the host");
      else onScene?.(res.data.scene);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Couldn't put that on screen");
    } finally {
      setModBusy(false);
      setModMenuFor(null);
    }
  };

  const modUnfeature = async (messageId: string) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { scene: unknown } }>(
        `/api/streams/${streamId}/chat/${messageId}/feature`,
        { method: "DELETE" }
      );
      onScene?.(res.data.scene);
    } catch {
      // It comes down at its time anyway.
    } finally {
      setModBusy(false);
      setModMenuFor(null);
    }
  };

  const modUnpin = async () => {
    setPinned(null);
    try {
      await apiFetch(`/api/streams/${streamId}/pin`, { method: "DELETE" });
    } catch {
      // Worst case the banner returns with the next pin event.
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || !user || sending) return;
    // Slow mode: viewers wait between messages; the host doesn't.
    if (slowFor && cooldownLeft > 0) return;
    setSending(true);
    setInput("");
    const ok = await submitMessage(
      { username: user.username, avatar: user.avatar, content, type: "text", platform: "xstream" },
      { content, type: "text", platform: "xstream" }
    );
    // A refused message comes back to the input rather than vanishing.
    if (!ok) setInput(content);
    else if (slowFor) setCooldownLeft(SLOW_MODE_SECONDS);
    setSending(false);
  };

  const sendReaction = async (emoji: string) => {
    if (!user || sending) return;
    setSending(true);
    setShowReactions(false);
    await submitMessage(
      { username: user.username, avatar: user.avatar, content: emoji, type: "reaction", emoji, platform: "xstream" },
      { content: emoji, type: "reaction", emoji, platform: "xstream" }
    );
    setSending(false);
  };

  /** The spendable balance, so the gift keyboard can say what's affordable. */
  const loadWalletBalance = useCallback(async () => {
    if (!user) return;
    setWalletLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: { availableUsdMinor: number } }>("/api/wallet/balance");
      setWalletMinor(res.data.availableUsdMinor);
    } catch {
      setWalletMinor(null);
    } finally {
      setWalletLoading(false);
    }
  }, [user]);

  // Fresh each time the keyboard opens — gifts sent elsewhere count.
  useEffect(() => {
    if (showGiftPanel) loadWalletBalance();
  }, [showGiftPanel, loadWalletBalance]);

  // A wallet-funded gift: the money moves server-side and the API writes
  // the chat line; nothing shows here unless the charge went through.
  const sendGift = async ({ gift, usdMinor: amountUsdMinor }: { gift: GiftDef | null; usdMinor: number }) => {
    if (!user || giftBusy) return;
    if (amountUsdMinor < GIFT_MIN_MINOR || amountUsdMinor > GIFT_MAX_MINOR) {
      setGiftError("Gifts run from $0.50 to $1,000.");
      return;
    }
    setGiftBusy(true);
    setGiftError(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { chatMessage: { _id?: string; content: string; tipAmount: string; emoji: string | null } };
      }>(`/api/streams/${streamId}/gifts`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          amountUsdMinor,
          platform: "xstream",
          ...(gift ? { giftName: gift.name, emoji: gift.emoji } : {}),
        }),
      });
      const line = res.data.chatMessage;
      append([
        {
          id: line._id ?? `local-${Date.now()}`,
          username: user.username,
          avatar: user.avatar,
          content: line.content,
          type: "tip",
          tipAmount: line.tipAmount,
          tipCurrency: "USD",
          emoji: line.emoji ?? undefined,
          at: Date.now(),
        },
      ]);
      setShowGiftPanel(false);
      // Show the spend at once, then reconcile with the wallet service.
      setWalletMinor((prev) => (prev === null ? prev : Math.max(0, prev - amountUsdMinor)));
      loadWalletBalance();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setGiftError("Insufficient balance — top up your dollar wallet to send gifts.");
        loadWalletBalance();
      } else if (err instanceof ApiError && err.status === 503) {
        setGiftError("Gifting isn't available right now. Try again later.");
      } else {
        setGiftError(err instanceof Error ? err.message : "Could not send the gift.");
      }
    } finally {
      setGiftBusy(false);
    }
  };

  // A Shout: the words ride with the gift and pin over the chat. The API
  // filters them before any money moves, and writes the line.
  const sendShout = async (amountUsdMinor: number, message: string) => {
    if (!user || giftBusy) return;
    setGiftBusy(true);
    setGiftError(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { chatMessage: { _id?: string; content: string; tipAmount: string; emoji: string | null; shoutUntil?: string | null } };
      }>(`/api/streams/${streamId}/gifts`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amountUsdMinor, platform: "xstream", message }),
      });
      const row = res.data.chatMessage;
      const line: ChatMsg = {
        id: row._id ?? `local-${Date.now()}`,
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        content: row.content,
        type: "tip",
        tipAmount: row.tipAmount,
        tipCurrency: "USD",
        emoji: row.emoji ?? undefined,
        at: Date.now(),
        ...(row.shoutUntil ? { shoutUntil: row.shoutUntil } : {}),
      };
      append([line]);
      pinShouts([line]);
      setShowGiftPanel(false);
      setWalletMinor((prev) => (prev === null ? prev : Math.max(0, prev - amountUsdMinor)));
      loadWalletBalance();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setGiftError("Insufficient balance — top up your dollar wallet to Shout.");
        loadWalletBalance();
      } else if (err instanceof ApiError && err.status === 503) {
        setGiftError("Shouts aren't available right now. Try again later.");
      } else {
        setGiftError(err instanceof Error ? err.message : "Could not send the Shout.");
      }
    } finally {
      setGiftBusy(false);
    }
  };

  const requestsForMe = !isHost && !crew && Boolean(user) && requests.menu.open;
  const openGifts = (tab: GiftTab) => {
    setGiftTab(tab);
    setShowGiftPanel(true);
    setShowReactions(false);
    setGiftError(null);
    if (requestsForMe) void requests.loadMine();
  };

  // ---- Drawing ----

  const lines = useMemo(() => foldLines(overlay ? messages.slice(-OVERLAY_LINES) : messages), [messages, overlay]);

  // Top three gifters wear their rank.
  const ranks = useMemo(() => {
    const map = new Map<string, number>();
    (topGifters ?? []).slice(0, 3).forEach((g, i) => map.set(g.username, i + 1));
    return map;
  }, [topGifters]);

  const badgesFor = (msg: ChatMsg) => {
    const suspect = msg.userId ? suspects.get(msg.userId) : undefined;
    return (
      <>
        {suspect && (
          <span
            title={suspect}
            aria-label={`Suspicious: ${suspect}`}
            className="mr-1 inline-flex h-4 items-center rounded-[4px] bg-warning/90 px-1 align-[1px] text-[9.5px] font-bold tracking-wide text-[#1a1203] uppercase"
          >
            Suspicious
          </span>
        )}
        <Badges
          host={Boolean(hostUsername) && msg.username === hostUsername}
          mod={msg.isMod}
          rank={ranks.get(msg.username)}
          fan={msg.fan}
          platform={msg.platform}
        />
      </>
    );
  };

  const toolButton = (label: string, onClick: () => void, icon: ReactNode, tone: "plain" | "danger" | "on" = "plain") => (
    <button
      type="button"
      onClick={onClick}
      disabled={modBusy}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-[8px] transition-colors disabled:opacity-50",
        tone === "danger"
          ? "text-chili-hi hover:bg-chili/15"
          : tone === "on"
            ? "bg-ember/[0.16] text-ember-hi hover:bg-ember/25"
            : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
      )}
    >
      {icon}
    </button>
  );

  // What's on screen now — its line wears "On stream", and its tool takes it down.
  const showing = useFeaturedShowing(isHost || crew ? featured : null);
  const onStreamId = showing?.id ?? null;

  // The screen button: the host's, and a moderator's as the host allows —
  // straight up, or as a suggestion the host decides on.
  const canFeature = role === "host" || role === "producer" || rules.modsCanFeature === "on";
  const featureTool = (msg: ChatMsg) =>
    canFeature
      ? onStreamId === msg.id
        ? toolButton("Take off stream", () => modUnfeature(msg.id), <MonitorPlay size={13} weight="fill" />, "on")
        : toolButton("Show on stream", () => modFeature(msg.id), <MonitorPlay size={13} />)
      : canModerate && rules.modsCanFeature === "suggest"
        ? toolButton("Suggest for the screen", () => modFeature(msg.id), <MonitorPlay size={13} />)
        : null;

  const isMine = (msg: ChatMsg) =>
    Boolean(user) && (msg.userId ? msg.userId === user!.id : msg.username === user!.username);
  const toolbar = (id: string, children: ReactNode) => (
    <div
      className={cn(
        "absolute -top-1 right-1 z-10 items-center gap-0.5 rounded-[10px] bg-popover p-0.5 shadow-[0_10px_28px_-10px_rgba(0,0,0,0.8)]",
        modMenuFor === id || reportFor === id ? "flex" : "hidden group-hover:flex"
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );

  /**
   * A line's tools. Moderators act on viewers' lines; the host also on a
   * moderator's (though never bans one — that's removing them as a
   * moderator first). Everyone else can report someone else's line.
   */
  const toolsFor = (msg: ChatMsg) => {
    if (msg.pending || isMine(msg)) return null;
    const hostLine = Boolean(hostUsername) && msg.username === hostUsername;
    if (!canModerate) {
      if (!user || hostLine) return null;
      return toolbar(
        msg.id,
        <>
          {toolButton("Report", () => {
            setReportFor(msg.id);
            setModMenuFor(msg.id);
          }, <Flag size={13} />)}
          {reportFor === msg.id && streamId && (
            <ReportMenu
              streamId={streamId}
              messageId={msg.id}
              username={msg.username}
              onClose={() => {
                setReportFor(null);
                setModMenuFor(null);
              }}
            />
          )}
        </>
      );
    }
    if (role !== "host" && (hostLine || msg.isMod)) return null;
    return toolbar(
      msg.id,
      <>
        {featureTool(msg)}
        {toolButton("Pin message", () => modPinMessage(msg.id), <PushPin size={13} />)}
        {toolButton("Delete message", () => modDeleteMessage(msg.id), <Trash size={13} />)}
        {msg.userId && !msg.isMod && (
          <>
            {toolButton("Timeout 10 minutes", () => modBanUser(msg.userId!, 10), <Timer size={13} />)}
            {toolButton("Ban from stream", () => modBanUser(msg.userId!), <Prohibit size={13} />, "danger")}
          </>
        )}
      </>
    );
  };

  // A dollar gift can go on screen too; drops and points can't.
  const giftFeaturable = (msg: ChatMsg) => canModerate && giftUnit(msg) === "usd" && !isDrop(msg) && featureTool(msg) !== null;
  const giftToolsFor = (msg: ChatMsg) => (giftFeaturable(msg) ? toolbar(msg.id, featureTool(msg)) : null);

  // Slow mode — or Shield, which brings it — holds back viewers, never moderators.
  const slowFor = (slowMode || rules.shield) && !canModerate;
  const canSend = Boolean(input.trim()) && cooldownLeft === 0 && !sending;
  const placeholder =
    cooldownLeft > 0
      ? `Slow mode — wait ${cooldownLeft}s`
      : slowFor
        ? `Slow mode · ${SLOW_MODE_SECONDS}s between messages`
        : isHost
          ? "Message your viewers"
          : crew
            ? "Message the room"
          : overlay
            ? "Say something…"
            : "Send a message";

  const iconButton = (label: string, on: boolean, onClick: () => void, icon: ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={cn(
        "press flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
        overlay
          ? on ? "bg-white/15 text-white" : "text-white/75 hover:text-white"
          : on ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
      )}
    >
      {icon}
    </button>
  );

  return (
    // `relative`: the gift keyboard docks inside this column on desktop.
    <div
      className={cn(
        "relative flex h-full flex-col",
        overlay ? "pointer-events-none justify-end" : chrome ? "border-l border-white/[0.05] bg-background" : ""
      )}
    >
      {chrome && (
        <>
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <ChatCircleDots size={16} weight="fill" className="shrink-0 text-muted-foreground" />
              <h3 className="text-[14px] font-semibold text-foreground">Stream chat</h3>
              {rules.shield ? (
                <span className="flex items-center gap-1 rounded-full bg-ember/[0.14] px-2 py-0.5 text-[11px] font-semibold text-ember-hi">
                  <ShieldStar size={11} weight="fill" />
                  Shield
                </span>
              ) : (
                slowMode && (
                  <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    <Clock size={11} />
                    Slow
                  </span>
                )
              )}
            </div>
            {canModerate && (
              <div className="flex items-center gap-0.5">
                {iconButton(slowMode ? "Turn slow mode off" : "Turn slow mode on", slowMode, () => toggleSlowMode(!slowMode), <Clock size={16} />)}
                {iconButton("Moderation", showModTools, () => setShowModTools(!showModTools), (
                  <span className="relative">
                    <ShieldStar size={16} weight={rules.shield ? "fill" : "regular"} className={rules.shield ? "text-ember-hi" : undefined} />
                    {held.length > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-ember" />}
                  </span>
                ))}
              </div>
            )}
          </header>

          <TopGiftersBar gifters={topGifters ?? []} fans={topFans ?? []} me={myFan} />

          {canModerate && showModTools && (
            <div className="mx-3 mb-2 rounded-[12px] bg-white/[0.04] px-3.5 py-3">
              <p className="caps mb-2.5 font-mono text-[10px] text-muted-foreground">
                {role === "host" ? "Your room" : role === "producer" ? "Producer" : role === "lead" ? "Lead moderator" : "Moderator"}
              </p>
              <ModSwitch
                label="Slow mode"
                hint={`Viewers wait ${SLOW_MODE_SECONDS}s between messages`}
                on={slowMode}
                onChange={(v) => void toggleSlowMode(v)}
              />
              {(role === "host" || role === "producer" || role === "lead") && (
                <div className="mt-3">
                  <ModSwitch
                    label="Shield"
                    hint="Allies only, slow mode, links and scams blocked, brand-new accounts held"
                    on={rules.shield}
                    onChange={(v) => void toggleShield(v)}
                  />
                </div>
              )}
              {role === "host" && (
                <a
                  href="/settings#chat"
                  className="mt-3 flex h-8 items-center justify-center rounded-full bg-white/[0.06] text-[12px] font-semibold text-foreground/85 transition-colors hover:bg-white/[0.1]"
                >
                  Chat filter and moderators
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setShowModTools(false);
                }}
                className="mt-3 h-8 w-full rounded-full bg-white/[0.06] text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-chili/15 hover:text-chili-hi"
              >
                Clear chat on this screen
              </button>
            </div>
          )}
        </>
      )}

      {/* Shield: the room hears it's up, and why the rules are tighter. */}
      {rules.shield && (
        <div
          className={cn(
            "flex items-center gap-2 text-[12px] leading-snug font-medium",
            overlay
              ? "pointer-events-auto mb-1.5 w-fit rounded-full bg-black/60 px-3 py-1.5 text-white/90"
              : "mx-2 mb-2 rounded-[12px] bg-ember/[0.1] px-3 py-2 text-ember-hi"
          )}
        >
          <ShieldStar size={14} weight="fill" className="shrink-0" />
          {/* Over video it's a pill, so it keeps to one line. */}
          <span className={overlay ? "whitespace-nowrap" : undefined}>
            {overlay ? "Shield is up · allies only" : `Shield is up — allies only, ${SLOW_MODE_SECONDS}s between messages`}
          </span>
        </div>
      )}

      {canModerate && (
        <HeldQueue held={held} skin={skin} busyId={heldBusy} onApprove={(id) => void decideHeld(id, true)} onDeny={(id) => void decideHeld(id, false)} />
      )}

      {notice && (
        <p className={cn("text-[12px] font-medium", overlay ? "pointer-events-auto mb-1.5 w-fit rounded-full bg-black/60 px-3 py-1.5 text-white/90" : "mx-3 mb-2 text-ember-hi")}>
          {notice}
        </p>
      )}

      <ShoutRail shouts={shouts} skin={skin} />

      {/* The lines, and the pill that brings a reader back down. */}
      <div className={cn("relative", overlay ? "" : "min-h-0 flex-1")}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            "overflow-y-auto overscroll-contain",
            overlay
              ? // Newest at the bottom; older lines dissolve into the picture.
                "pointer-events-auto max-h-[34dvh] pb-1 scrollbar-none [mask-image:linear-gradient(to_top,black_78%,transparent)]"
              : "h-full px-2 py-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
          )}
        >
          {pinned && (
            <div
              className={cn(
                "sticky top-0 z-10 mb-1 flex items-start gap-2 rounded-[12px] px-3 py-2",
                overlay ? "w-fit max-w-full bg-black/60" : "bg-surface-raised"
              )}
            >
              <PushPin size={13} weight="fill" className="mt-0.5 shrink-0 text-ember-hi" />
              <p className={cn("min-w-0 flex-1 text-[12.5px] leading-snug", overlay ? "text-white/90" : "text-foreground/90")}>
                <span className="mr-1.5 font-semibold">{pinned.username}</span>
                {pinned.content}
              </p>
              {canModerate && (
                <button
                  type="button"
                  onClick={modUnpin}
                  title="Unpin"
                  aria-label="Unpin"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          {!overlay && lines.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <ChatCircleDots size={26} className="text-muted-foreground/40" />
              <p className="text-[13px] text-muted-foreground">
                {isLive ? "It's quiet in here — say hello." : "Chat is offline"}
              </p>
            </div>
          )}

          {lines.map((line) => (
            <div key={line.id} className="animate-in duration-200 fade-in slide-in-from-bottom-1">
              {line.kind === "drops" ? (
                <DropsLine catches={line.catches} skin={skin} />
              ) : line.kind === "stage" ? (
                <StageLine msg={line.msg} skin={skin} />
              ) : line.kind === "gift" ? (
                <GiftLine
                  msg={line.msg}
                  count={line.count}
                  total={line.total}
                  skin={skin}
                  badges={badgesFor(line.msg)}
                  tools={giftToolsFor(line.msg)}
                  onStream={onStreamId !== null && line.ids.includes(onStreamId)}
                  onTap={giftFeaturable(line.msg) ? () => setModMenuFor((cur) => (cur === line.id ? null : line.id)) : undefined}
                />
              ) : (
                <MessageLine
                  msg={line.msg}
                  skin={skin}
                  badges={badgesFor(line.msg)}
                  highlight={line.msg.username !== user?.username && mentions(line.msg.content, user?.username)}
                  tools={toolsFor(line.msg)}
                  onStream={onStreamId === line.msg.id}
                  onTap={
                    // Tap-to-toggle keeps the tools (or Report) reachable on touch.
                    toolsFor(line.msg) ? () => setModMenuFor((cur) => (cur === line.id ? null : line.id)) : undefined
                  }
                />
              )}
            </div>
          ))}
        </div>

        {paused && unseen > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="press pointer-events-auto absolute bottom-2 left-1/2 z-20 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12.5px] font-semibold whitespace-nowrap text-[#0b0708] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)]"
          >
            <ArrowDown size={14} weight="bold" />
            {unseen} new message{unseen === 1 ? "" : "s"}
          </button>
        )}
      </div>

      <ArrivalTicker arrival={arrival} skin={skin} />

      {/* The host is taking requests: one tap to their menu. */}
      {requestsForMe && isLive && !showGiftPanel && (
        <button
          type="button"
          onClick={() => openGifts("requests")}
          className={cn(
            "press flex w-fit max-w-full items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[12.5px] font-semibold",
            overlay ? "pointer-events-auto mb-1.5 bg-black/60 text-white/90" : "mx-3 mb-2 bg-white/[0.06] text-foreground/90 hover:bg-white/[0.1]"
          )}
        >
          <GiftArt art={REQUEST_GIFT.art} emoji={REQUEST_GIFT.emoji} size={22} />
          <span className="truncate">{hostUsername ? `${hostUsername} is taking requests` : "Requests are open"}</span>
          <span className={cn("shrink-0", overlay ? "text-white/60" : "text-muted-foreground")}>· {requests.menu.items.length} on the menu</span>
        </button>
      )}

      {showReactions && (
        <div className={cn("flex flex-wrap gap-1", overlay ? "pointer-events-auto mb-2 w-fit rounded-[16px] bg-black/60 p-1.5" : "px-3 pb-2")}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => sendReaction(emoji)}
              className="press flex size-9 items-center justify-center rounded-full text-lg transition-colors hover:bg-white/10"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Gift keyboard — wallet-funded, USD. Rises over the composer like
          a sticker keyboard; a sheet on phones. */}
      <GiftKeyboard
        open={showGiftPanel}
        onClose={() => {
          setShowGiftPanel(false);
          setGiftError(null);
        }}
        balanceMinor={walletMinor}
        balanceLoading={walletLoading}
        busy={giftBusy}
        error={giftError}
        onSend={(choice) => void sendGift(choice)}
        onShout={(usdMinor, message) => void sendShout(usdMinor, message)}
        openTab={giftTab}
        requests={
          requestsForMe || requests.mine.pending.length > 0
            ? {
                hostName: hostUsername ?? "the host",
                menu: requests.menu,
                mine: [...requests.mine.pending, ...requests.mine.decided],
                onOrder: async (itemId, note) => {
                  try {
                    await requests.order(itemId, note);
                    setWalletMinor((prev) => {
                      const item = requests.menu.items.find((i) => i.id === itemId);
                      return prev === null || !item ? prev : Math.max(0, prev - item.priceUsdMinor);
                    });
                    loadWalletBalance();
                  } catch (err) {
                    if (err instanceof ApiError && err.status === 402) {
                      loadWalletBalance();
                      throw new Error("Not enough in your dollar wallet — top up to ask.");
                    }
                    throw err;
                  }
                },
              }
            : null
        }
      />

      {beforeComposer && <div className="pointer-events-auto">{beforeComposer}</div>}

      {/* Composer */}
      <div
        className={cn(
          variant === "sheet"
            ? "px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)]"
            : overlay
              ? "pointer-events-auto pt-1"
              : "px-3 pt-1 pb-3"
        )}
      >
        {chatError && isLive && user && <p className="mb-2 px-1 text-[12px] text-chili-hi">{chatError}</p>}
        {isLive && user && myBan ? (
          <div className="flex h-10 items-center justify-center gap-2 rounded-full bg-chili/[0.12] text-[12.5px] font-semibold text-chili-hi">
            <Prohibit size={14} />
            {myBan.until
              ? `You're timed out until ${new Date(myBan.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "You've been banned from this chat"}
          </div>
        ) : isLive && !user ? (
          <a
            href={SIGN_IN_URL}
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-full text-[13.5px] font-semibold transition-colors",
              overlay ? "bg-black/50 text-white/90 hover:text-white" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1] hover:text-foreground"
            )}
          >
            <SignIn size={16} />
            Sign in to chat
          </a>
        ) : isLive ? (
          <div className={cn("flex items-center gap-1", overlay ? "h-11 rounded-full bg-black/50 px-1" : "")}>
            {iconButton(
              "Reactions",
              showReactions,
              () => {
                setShowReactions(!showReactions);
                setShowGiftPanel(false);
              },
              <Smiley size={20} />
            )}
            {!isHost &&
              !crew &&
              iconButton(
                "Send a gift",
                showGiftPanel,
                () => {
                  if (showGiftPanel) setShowGiftPanel(false);
                  else openGifts("gifts");
                },
                <Gift size={19} weight="fill" className={showGiftPanel ? "text-value" : undefined} />
              )}
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center rounded-full pr-1",
                overlay ? "h-full pl-1" : "h-10 bg-white/[0.06] pl-4 focus-within:bg-white/[0.09]"
              )}
            >
              <input
                type="text"
                placeholder={placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                disabled={cooldownLeft > 0 || sending}
                maxLength={500}
                aria-label="Chat message"
                className={cn(
                  "h-full min-w-0 flex-1 bg-transparent text-[13.5px] outline-none disabled:cursor-not-allowed disabled:opacity-60",
                  overlay ? "px-1.5 text-white placeholder:text-white/50" : "text-foreground placeholder:text-muted-foreground"
                )}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!canSend}
                aria-label="Send"
                className={cn(
                  "press flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                  canSend ? "bg-white text-[#0b0708]" : overlay ? "text-white/40" : "text-muted-foreground/50"
                )}
              >
                {cooldownLeft > 0 ? (
                  <span className="font-mono text-[11px] font-bold">{cooldownLeft}</span>
                ) : sending ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <ArrowUp size={17} weight="bold" />
                )}
              </button>
            </div>
          </div>
        ) : overlay ? null : (
          <p className="py-2 text-center text-[12px] text-muted-foreground/60">Chat is offline — the stream has ended</p>
        )}
      </div>
    </div>
  );
}

/** A switch in the moderation panel: what it does, and whether it's on. */
function ModSwitch({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] font-medium text-foreground/90">
        {label}
        <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>
      </span>
      <button
        type="button"
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-ember" : "bg-white/15")}
      >
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", on ? "left-[calc(100%-1.125rem)]" : "left-0.5")} />
      </button>
    </div>
  );
}
