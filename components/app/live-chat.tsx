"use client";

import { SIGN_IN_URL } from "@/lib/auth-urls";
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChatCircleDots,
  Clock,
  Gift,
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
import { GIFT_MAX_MINOR, GIFT_MIN_MINOR, type GiftDef } from "@/lib/gifts";
import { GiftKeyboard } from "@/components/app/gift-keyboard";
import { foldLines, mentions, type ChatMsg, type ChatPlatform } from "@/components/app/chat/lines";
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
  /** The host's username, so their lines wear a Host badge. */
  hostUsername?: string;
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
  initialPinned = null,
  variant = "panel",
  beforeComposer,
  topGifters,
  hostUsername,
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  // Ids already drawn — the local echo and the server's room broadcast of
  // the same persisted message must not both appear.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const slowModeRef = useRef(false);
  const seededSlowMode = useRef(false);
  const pausedRef = useRef(false);
  /** Lines appended since the scroll last caught up. */
  const appendedRef = useRef(0);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    slowModeRef.current = slowMode;
  }, [slowMode]);

  // The battle bar's "Back this side" opens the same gift panel from outside
  // the chat column, so backing a side is one tap from the player.
  useEffect(() => {
    const open = () => setShowGiftPanel(true);
    window.addEventListener("xtreme:open-gifts", open);
    return () => window.removeEventListener("xtreme:open-gifts", open);
  }, []);

  // Host: seed slow mode from the saved profile setting.
  useEffect(() => {
    if (isHost && user && !seededSlowMode.current) {
      seededSlowMode.current = true;
      setSlowMode(user.settings?.slowMode ?? false);
    }
  }, [isHost, user]);

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
            }>;
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
        }));
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
  }, [streamId]);

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
            messageId?: string;
            until?: string | null;
            message?: PinnedMessage;
            action?: string;
          };

          if (data.__evt) {
            switch (data.__evt) {
              case "slowmode":
                if (!isHost) setSlowMode(!!data.enabled);
                return;
              // The host deleted one message: it vanishes for everyone at once.
              case "chat_delete":
                if (data.messageId) setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
                return;
              // A ban wipes that user's lines everywhere; the banned client
              // also locks its own composer.
              case "chat_ban":
                if (data.userId) {
                  setMessages((prev) => prev.filter((m) => m.userId !== data.userId));
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
          append([
            {
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
            },
          ]);
        } catch {
          // Not a chat payload.
        }
      };

      room.on(RoomEvent.DataReceived, handleData);
      (room as unknown as Record<string, unknown>).__chatHandler = handleData;

      // Host: tell viewers who join mid-stream whether slow mode is on.
      if (isHost) {
        const handleJoin = () => {
          try {
            const payload = new TextEncoder().encode(JSON.stringify({ __evt: "slowmode", enabled: slowModeRef.current }));
            room.localParticipant.publishData(payload, { reliable: true });
          } catch {
            // Room may be disconnected.
          }
        };
        room.on(RoomEvent.ParticipantConnected, handleJoin);
        (room as unknown as Record<string, unknown>).__joinHandler = handleJoin;
      }
    };

    setup();

    return () => {
      if (eventName && room) {
        const handler = (room as unknown as Record<string, unknown>).__chatHandler;
        if (handler) room.off(eventName as Parameters<typeof room.off>[0], handler as Parameters<typeof room.off>[1]);
        const joinHandler = (room as unknown as Record<string, unknown>).__joinHandler;
        if (joinHandler) room.off("participantConnected" as Parameters<typeof room.off>[0], joinHandler as Parameters<typeof room.off>[1]);
      }
      attachedRef.current = false;
    };
  }, [room, user?.id, isHost, append, noteArrival]);

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

  // Host: toggle slow mode, tell the room, keep the preference.
  const toggleSlowMode = useCallback(
    (enabled: boolean) => {
      setSlowMode(enabled);
      if (room?.localParticipant) {
        try {
          const payload = new TextEncoder().encode(JSON.stringify({ __evt: "slowmode", enabled }));
          room.localParticipant.publishData(payload, { reliable: true });
        } catch {
          // Room may be disconnected.
        }
      }
      apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify({ settings: { slowMode: enabled } }),
      }).catch(() => {});
    },
    [room]
  );

  /**
   * Persist first, then show. The API fans the saved message into the room
   * itself, so a message it refuses (slow mode, followers-only, a ban)
   * never reaches anyone — and the sender sees why.
   */
  const submitMessage = async (msg: Omit<ChatMsg, "id" | "at">, body: Record<string, unknown>) => {
    setChatError(null);
    let savedId: string | null = null;
    try {
      const saved = await apiFetch<{ success: boolean; data: { message: { _id: string } } }>(
        `/api/streams/${streamId}/chat`,
        { method: "POST", body: JSON.stringify(body) }
      );
      savedId = saved?.data?.message?._id ?? null;
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
    append([{ ...msg, id: savedId ?? `local-${Date.now()}`, at: Date.now() }]);
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
    if (slowMode && !isHost && cooldownLeft > 0) return;
    setSending(true);
    setInput("");
    const ok = await submitMessage(
      { username: user.username, avatar: user.avatar, content, type: "text", platform: "xstream" },
      { content, type: "text", platform: "xstream" }
    );
    // A refused message comes back to the input rather than vanishing.
    if (!ok) setInput(content);
    else if (slowMode && !isHost) setCooldownLeft(SLOW_MODE_SECONDS);
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

  // ---- Drawing ----

  const lines = useMemo(() => foldLines(overlay ? messages.slice(-OVERLAY_LINES) : messages), [messages, overlay]);

  // Top three gifters wear their rank.
  const ranks = useMemo(() => {
    const map = new Map<string, number>();
    (topGifters ?? []).slice(0, 3).forEach((g, i) => map.set(g.username, i + 1));
    return map;
  }, [topGifters]);

  const badgesFor = (msg: ChatMsg) => (
    <Badges
      host={Boolean(hostUsername) && msg.username === hostUsername}
      mod={msg.isMod}
      rank={ranks.get(msg.username)}
      platform={msg.platform}
    />
  );

  const toolButton = (label: string, onClick: () => void, icon: ReactNode, danger = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={modBusy}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-[8px] transition-colors disabled:opacity-50",
        danger ? "text-chili-hi hover:bg-chili/15" : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
      )}
    >
      {icon}
    </button>
  );

  const toolsFor = (msg: ChatMsg) =>
    isHost && !msg.isMod ? (
      <div
        className={cn(
          "absolute -top-1 right-1 z-10 items-center gap-0.5 rounded-[10px] bg-popover p-0.5 shadow-[0_10px_28px_-10px_rgba(0,0,0,0.8)]",
          modMenuFor === msg.id ? "flex" : "hidden group-hover:flex"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {toolButton("Pin message", () => modPinMessage(msg.id), <PushPin size={13} />)}
        {toolButton("Delete message", () => modDeleteMessage(msg.id), <Trash size={13} />)}
        {msg.userId && (
          <>
            {toolButton("Timeout 10 minutes", () => modBanUser(msg.userId!, 10), <Timer size={13} />)}
            {toolButton("Ban from stream", () => modBanUser(msg.userId!), <Prohibit size={13} />, true)}
          </>
        )}
      </div>
    ) : null;

  const canSend = Boolean(input.trim()) && cooldownLeft === 0 && !sending;
  const placeholder =
    cooldownLeft > 0
      ? `Slow mode — wait ${cooldownLeft}s`
      : slowMode && !isHost
        ? `Slow mode · ${SLOW_MODE_SECONDS}s between messages`
        : isHost
          ? "Message your viewers"
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
              {slowMode && (
                <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  <Clock size={11} />
                  Slow
                </span>
              )}
            </div>
            {isHost && (
              <div className="flex items-center gap-0.5">
                {iconButton(slowMode ? "Turn slow mode off" : "Turn slow mode on", slowMode, () => toggleSlowMode(!slowMode), <Clock size={16} />)}
                {iconButton("Moderation", showModTools, () => setShowModTools(!showModTools), <ShieldStar size={16} />)}
              </div>
            )}
          </header>

          <TopGiftersBar gifters={topGifters ?? []} />

          {isHost && showModTools && (
            <div className="mx-3 mb-2 rounded-[12px] bg-white/[0.04] px-3.5 py-3">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-[12.5px] font-medium text-foreground/90">
                  Slow mode
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    Viewers wait {SLOW_MODE_SECONDS}s between messages
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleSlowMode(!slowMode)}
                  role="switch"
                  aria-checked={slowMode}
                  className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", slowMode ? "bg-ember" : "bg-white/15")}
                >
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-white transition-all", slowMode ? "left-[calc(100%-1.125rem)]" : "left-0.5")} />
                </button>
              </label>
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
              {isHost && (
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
                <GiftLine msg={line.msg} count={line.count} total={line.total} skin={skin} badges={badgesFor(line.msg)} />
              ) : (
                <MessageLine
                  msg={line.msg}
                  skin={skin}
                  badges={badgesFor(line.msg)}
                  highlight={line.msg.username !== user?.username && mentions(line.msg.content, user?.username)}
                  tools={toolsFor(line.msg)}
                  onTap={
                    // Tap-to-toggle keeps the tools reachable on touch.
                    isHost && !line.msg.isMod ? () => setModMenuFor((cur) => (cur === line.id ? null : line.id)) : undefined
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
              iconButton(
                "Send a gift",
                showGiftPanel,
                () => {
                  setShowGiftPanel(!showGiftPanel);
                  setShowReactions(false);
                  setGiftError(null);
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
