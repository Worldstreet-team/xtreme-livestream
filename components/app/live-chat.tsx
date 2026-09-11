"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  PaperPlaneRight,
  Smiley,
  ShieldStar,
  Clock,
  Gift,
  SignIn,
  HandWaving,
  Heart,
  Prohibit,
  PushPin,
  Timer,
  Trash,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api-client";
import { GIFT_MAX_MINOR, GIFT_MIN_MINOR, type GiftDef } from "@/lib/gifts";
import { GiftArt } from "@/components/app/gift-art";
import { GiftKeyboard } from "@/components/app/gift-keyboard";
import type { Room } from "livekit-client";

const SLOW_MODE_SECONDS = 30;


const QUICK_REACTIONS = [
  "🔥",
  "🚀",
  "💎",
  "🙌",
  "💰",
  "📈",
  "📉",
  "🐻",
  "🐂",
  "😂",
];

interface ChatMsg {
  id: string;
  /** Sender's user id — what the host's ban/timeout buttons act on. */
  userId?: string;
  username: string;
  avatar: string;
  isMod?: boolean;
  /** Surface the sender was on; "socials" gets a badge here. */
  platform?: "xstream" | "socials" | "worldspace";
  /** "join", "like" and "stage" are display-only system rows, never sent.
   *  For "stage" rows, `content` carries the verb ("joined the stage"). */
  content: string;
  type: "text" | "tip" | "reaction" | "join" | "like" | "stage";
  tipAmount?: string;
  tipCurrency?: string;
  emoji?: string;
  timestamp: string;
}

export interface PinnedMessage {
  messageId: string;
  username: string;
  avatar: string;
  content: string;
}

interface LiveChatProps {
  streamId: string;
  room: Room | null;
  isLive: boolean;
  /** Hide the tip button (host doesn't tip themselves) */
  isHost?: boolean;
  /** Pin persisted on the stream doc, so late joiners see it. */
  initialPinned?: PinnedMessage | null;
}

export function LiveChat({
  streamId,
  room,
  isLive,
  isHost = false,
  initialPinned = null,
}: LiveChatProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [showReactions, setShowReactions] = useState(false);
  const [showGiftPanel, setShowGiftPanel] = useState(false);

  // The battle bar's "Back this side" opens the same gift panel from outside
  // the chat column, so backing a side is one tap from the player.
  useEffect(() => {
    const open = () => setShowGiftPanel(true);
    window.addEventListener("xtreme:open-gifts", open);
    return () => window.removeEventListener("xtreme:open-gifts", open);
  }, []);
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
  /** Host-pinned message banner. */
  const [pinned, setPinned] = useState<PinnedMessage | null>(initialPinned);
  /** Set when *I* am the one banned — locks the composer. */
  const [myBan, setMyBan] = useState<{ until: string | null } | null>(null);
  /** Message row whose host tools are open (tap-friendly, not hover-only). */
  const [modMenuFor, setModMenuFor] = useState<string | null>(null);
  const [modBusy, setModBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  // Message ids already rendered — the local echo and the server's room
  // broadcast of the same persisted message must not both appear.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const slowModeRef = useRef(false);
  slowModeRef.current = slowMode;

  // Host: seed slow mode from the saved profile setting
  const seededSlowMode = useRef(false);
  useEffect(() => {
    if (isHost && user && !seededSlowMode.current) {
      seededSlowMode.current = true;
      setSlowMode(user.settings?.slowMode ?? false);
    }
  }, [isHost, user]);

  // Countdown ticker while a slow-mode cooldown is active
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setTimeout(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownLeft]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load chat history from API
  useEffect(() => {
    async function loadHistory() {
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
              content: string;
              type: "text" | "tip" | "reaction";
              tipAmount?: string;
              tipCurrency?: string;
              emoji?: string;
              createdAt: string;
            }>;
          };
        }>(`/api/streams/${streamId}/chat`);

        const history = res.data.messages.map((m) => ({
          id: m._id,
          userId: m.userId ? String(m.userId) : undefined,
          username: m.username,
          avatar: m.avatar,
          isMod: m.isMod,
          content: m.content,
          type: m.type,
          tipAmount: m.tipAmount,
          tipCurrency: m.tipCurrency,
          emoji: m.emoji,
          timestamp: new Date(m.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        }));
        for (const h of history) seenIdsRef.current.add(h.id);
        setMessages(history);
      } catch {
        // Failed to load history — not fatal
      }
    }
    if (streamId) loadHistory();
  }, [streamId]);

  // Listen for incoming LiveKit data messages (real-time chat from other users)
  useEffect(() => {
    if (!room || attachedRef.current) return;
    attachedRef.current = true;

    let eventName: string | undefined;

    const setup = async () => {
      const { RoomEvent } = await import("livekit-client");
      eventName = RoomEvent.DataReceived;

      const handleData = (
        payload: Uint8Array,
        participant?: { identity: string }
      ) => {
        if (participant?.identity === user?.id) return;
        try {
          const decoded = new TextDecoder().decode(payload);
          const data = JSON.parse(decoded) as ChatMsg & {
            __evt?: string;
            enabled?: boolean;
          };

          // Engagement/moderation events — not chat messages
          if (data.__evt) {
            if (data.__evt === "slowmode" && !isHost) {
              setSlowMode(!!data.enabled);
            }
            // Host deleted one message: it vanishes for everyone at once.
            if (data.__evt === "chat_delete") {
              const target = (data as { messageId?: string }).messageId;
              if (target) {
                setMessages((prev) => prev.filter((m) => m.id !== target));
              }
              return;
            }
            // A ban wipes that user's rows everywhere; the banned client
            // additionally locks its own composer.
            if (data.__evt === "chat_ban") {
              const evt = data as { userId?: string; until?: string | null };
              if (evt.userId) {
                setMessages((prev) =>
                  prev.filter((m) => m.userId !== evt.userId)
                );
                if (evt.userId === user?.id) {
                  setMyBan({ until: evt.until ?? null });
                }
              }
              return;
            }
            if (data.__evt === "chat_unban") {
              const evt = data as { userId?: string };
              if (evt.userId === user?.id) setMyBan(null);
              return;
            }
            if (data.__evt === "pin") {
              const evt = data as { message?: PinnedMessage };
              if (evt.message) setPinned(evt.message);
              return;
            }
            if (data.__evt === "unpin") {
              setPinned(null);
              return;
            }
            // The shared handshake: arrivals and likes appear as quiet
            // system rows on both platforms.
            const evtUser = (data as { username?: string }).username;
            // Stage transitions read like room events too — "X joined the
            // stage" is half the reason to tap Join yourself.
            if (data.__evt === "guest_update" && evtUser) {
              const action = (data as { action?: string }).action;
              const verb =
                action === "approved"
                  ? "joined the stage"
                  : action === "left"
                    ? "left the stage"
                    : action === "removed"
                      ? "was removed from the stage"
                      : null;
              if (verb) {
                const row: ChatMsg = {
                  id: `stage-${evtUser}-${Date.now()}`,
                  username: evtUser,
                  avatar: "",
                  content: verb,
                  type: "stage",
                  timestamp: new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                };
                seenIdsRef.current.add(row.id);
                setMessages((prev) => [...prev, row]);
              }
              return;
            }
            if (
              (data.__evt === "join" || data.__evt === "like") &&
              evtUser
            ) {
              const row: ChatMsg = {
                id: `${data.__evt}-${evtUser}-${Date.now()}`,
                username: evtUser,
                avatar: "",
                content: "",
                type: data.__evt as "join" | "like",
                platform: (data as { platform?: ChatMsg["platform"] })
                  .platform,
                timestamp: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              };
              seenIdsRef.current.add(row.id);
              setMessages((prev) => [...prev, row]);
            }
            return;
          }

          const id = String(data.id ?? `rt-${Date.now()}-${Math.random()}`);
          if (seenIdsRef.current.has(id)) return;
          seenIdsRef.current.add(id);
          setMessages((prev) => [...prev, { ...data, id }]);
        } catch {
          // Ignore malformed data
        }
      };

      room.on(RoomEvent.DataReceived, handleData);
      // Store for cleanup
      (room as unknown as Record<string, unknown>).__chatHandler = handleData;

      // Host: sync current slow-mode state to viewers who join mid-stream
      if (isHost) {
        const handleJoin = () => {
          try {
            const payload = new TextEncoder().encode(
              JSON.stringify({
                __evt: "slowmode",
                enabled: slowModeRef.current,
              })
            );
            room.localParticipant.publishData(payload, { reliable: true });
          } catch {
            // Room may be disconnected
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
        if (handler) {
          room.off(eventName as Parameters<typeof room.off>[0], handler as Parameters<typeof room.off>[1]);
        }
        const joinHandler = (room as unknown as Record<string, unknown>).__joinHandler;
        if (joinHandler) {
          room.off("participantConnected" as Parameters<typeof room.off>[0], joinHandler as Parameters<typeof room.off>[1]);
        }
      }
      attachedRef.current = false;
    };
  }, [room, user?.id, isHost]);

  // Host-only: toggle slow mode, broadcast to viewers, persist the setting
  const toggleSlowMode = useCallback(
    (enabled: boolean) => {
      setSlowMode(enabled);

      if (room?.localParticipant) {
        try {
          const payload = new TextEncoder().encode(
            JSON.stringify({ __evt: "slowmode", enabled })
          );
          room.localParticipant.publishData(payload, { reliable: true });
        } catch {
          // Room may be disconnected
        }
      }

      // Persist so the preference sticks for future streams (best-effort)
      apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify({ settings: { slowMode: enabled } }),
      }).catch(() => {});
    },
    [room]
  );

  /**
   * Persist first, then show and broadcast.
   *
   * This used to run the other way round — render locally, publish over the
   * LiveKit data channel, then POST as fire-and-forget. That made the
   * server's moderation rules cosmetic: a message rejected for slow mode or
   * followers-only chat had already reached every viewer in the room, and the
   * rejection was swallowed, so the sender saw it succeed. Waiting for the
   * write costs a round-trip but means "rejected" actually means rejected.
   */
  const submitMessage = async (
    msg: Omit<ChatMsg, "id" | "timestamp">,
    body: Record<string, unknown>
  ) => {
    setChatError(null);
    let savedId: string | null = null;
    try {
      const saved = await apiFetch<{
        success: boolean;
        data: { message: { _id: string } };
      }>(`/api/streams/${streamId}/chat`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      savedId = saved?.data?.message?._id ?? null;
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : "Couldn't send that message."
      );
      // Slow mode rejections carry the remaining wait; start the countdown so
      // the input reflects it rather than letting the user hammer the button.
      if (err instanceof ApiError && err.status === 429) {
        setCooldownLeft(SLOW_MODE_SECONDS);
      }
      // A BANNED rejection locks the composer outright — the chat_ban event
      // usually beat us here, but a race (or a rejoin) shouldn't leave an
      // enabled input that can only ever fail.
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

    const full: ChatMsg = {
      ...msg,
      // The persisted id, so the server's room broadcast of this same
      // message dedupes against this local echo instead of doubling it.
      id: savedId ?? `local-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    if (full.id) seenIdsRef.current.add(full.id);
    setMessages((prev) => [...prev, full]);
    // No client-side rebroadcast: the API fans the persisted message into
    // the room itself. Publishing here too used to be the ONLY delivery
    // path — and silence for any sender without canPublishData.
    return true;
  };

  // ---- Host moderation actions ----
  // The API fans the matching event into the room, which is what actually
  // mutates every client's view (including this one) — these handlers only
  // do optimistic local cleanup so the host's own UI feels instant.

  const modDeleteMessage = async (messageId: string) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      await apiFetch(`/api/streams/${streamId}/chat/${messageId}`, {
        method: "DELETE",
      });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch {
      // Row stays; the host can retry.
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
      // Ban failed — leave the rows.
    } finally {
      setModBusy(false);
      setModMenuFor(null);
    }
  };

  const modPinMessage = async (messageId: string) => {
    if (modBusy) return;
    setModBusy(true);
    try {
      await apiFetch(`/api/streams/${streamId}/chat/${messageId}/pin`, {
        method: "POST",
      });
      const msg = messages.find((m) => m.id === messageId);
      if (msg) {
        setPinned({
          messageId,
          username: msg.username,
          avatar: msg.avatar,
          content: msg.content,
        });
      }
    } catch {
      // Pin failed — banner unchanged.
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
      // Worst case the banner comes back on next pin event.
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || !user || sending) return;

    // Slow mode: viewers must wait between messages (host is exempt)
    if (slowMode && !isHost && cooldownLeft > 0) return;

    setSending(true);
    setInput("");

    const ok = await submitMessage(
      {
        username: user.username,
        avatar: user.avatar,
        content,
        type: "text",
        platform: "xstream",
      },
      { content, type: "text", platform: "xstream" }
    );

    // Restore the draft so a rejected message isn't silently lost.
    if (!ok) setInput(content);
    else if (slowMode && !isHost) setCooldownLeft(SLOW_MODE_SECONDS);

    setSending(false);
  };

  const sendReaction = async (emoji: string) => {
    if (!user || sending) return;

    setSending(true);
    setShowReactions(false);

    await submitMessage(
      {
        username: user.username,
        avatar: user.avatar,
        content: emoji,
        type: "reaction",
        emoji,
        platform: "xstream",
      },
      { content: emoji, type: "reaction", emoji, platform: "xstream" }
    );

    setSending(false);
  };

  /**
   * Load the spendable wallet balance so the viewer knows what they can gift.
   * Best-effort: if the wallet service is down we just hide the figure rather
   * than blocking gifting, since the charge itself is authoritative.
   */
  const loadWalletBalance = useCallback(async () => {
    if (!user) return;
    setWalletLoading(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { availableUsdMinor: number };
      }>("/api/wallet/balance");
      setWalletMinor(res.data.availableUsdMinor);
    } catch {
      setWalletMinor(null);
    } finally {
      setWalletLoading(false);
    }
  }, [user]);

  // Refresh the balance each time the gift panel opens, so it reflects gifts
  // sent elsewhere (other tabs/streams) rather than a stale first read.
  useEffect(() => {
    if (showGiftPanel) loadWalletBalance();
  }, [showGiftPanel, loadWalletBalance]);

  // Send a wallet-funded gift. The money moves server-side (central dollar
  // wallet); the API also persists the chat announcement. Nothing is shown
  // locally unless the charge actually succeeded.
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
        data: {
          chatMessage: {
            content: string;
            tipAmount: string;
            emoji: string | null;
          };
        };
      }>(`/api/streams/${streamId}/gifts`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          amountUsdMinor,
          platform: "xstream",
          ...(gift ? { giftName: gift.name, emoji: gift.emoji } : {}),
        }),
      });

      const announcement = res.data.chatMessage as typeof res.data.chatMessage & {
        _id?: string;
      };
      const msg: ChatMsg = {
        id: announcement._id ?? `local-${Date.now()}`,
        username: user.username,
        avatar: user.avatar,
        content: announcement.content,
        type: "tip",
        tipAmount: announcement.tipAmount,
        tipCurrency: "USD",
        emoji: announcement.emoji ?? undefined,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      seenIdsRef.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
      // The gifts API broadcasts the announcement into the room itself.
      setShowGiftPanel(false);
      // Reflect the spend immediately, then reconcile with the wallet service.
      setWalletMinor((prev) =>
        prev === null ? prev : Math.max(0, prev - amountUsdMinor)
      );
      loadWalletBalance();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setGiftError(
          "Insufficient balance — top up your dollar wallet to send gifts."
        );
        loadWalletBalance();
      } else if (err instanceof ApiError && err.status === 503) {
        setGiftError("Gifting isn't available right now. Try again later.");
      } else {
        setGiftError(
          err instanceof Error ? err.message : "Could not send the gift."
        );
      }
    } finally {
      setGiftBusy(false);
    }
  };

  return (
    // `relative`: the gift keyboard docks inside this column on desktop.
    <div className="relative flex h-full flex-col border-l border-white/5 bg-background">
      {/* Chat header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Live Chat</h3>
          {slowMode && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6rem] font-medium text-primary">
              <Clock size={10} />
              Slow mode
            </span>
          )}
        </div>
        {isHost && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleSlowMode(!slowMode)}
              title={slowMode ? "Disable slow mode" : "Enable slow mode"}
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                slowMode
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <Clock size={16} />
            </button>
            <button
              onClick={() => setShowModTools(!showModTools)}
              title="Mod Tools"
              className={cn(
                "flex size-7 items-center justify-center rounded-sm transition-colors",
                showModTools
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <ShieldStar size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Mod tools panel (host only) */}
      {isHost && showModTools && (
        <div className="border-b border-white/5 bg-white/[0.02] px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-foreground">
            Moderation
          </p>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Slow mode
              <span className="block text-[0.6rem] text-muted-foreground/60">
                Viewers wait {SLOW_MODE_SECONDS}s between messages
              </span>
            </span>
            <button
              onClick={() => toggleSlowMode(!slowMode)}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                slowMode ? "bg-primary" : "bg-white/10"
              )}
              role="switch"
              aria-checked={slowMode}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white transition-all",
                  slowMode ? "left-[calc(100%-1.125rem)]" : "left-0.5"
                )}
              />
            </button>
          </label>
          <button
            onClick={() => {
              setMessages([]);
              setShowModTools(false);
            }}
            className="mt-3 h-8 w-full rounded-sm border border-white/10 text-xs font-medium text-muted-foreground transition-colors hover:border-red-500/30 hover:text-red-400"
          >
            Clear chat (local)
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="relative flex-1 space-y-1 overflow-y-auto px-3 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
      >
        {pinned && (
          <div className="sticky top-0 z-10 -mx-1 mb-1 flex items-start gap-2 rounded-sm border border-primary/25 bg-[oklch(0.14_0.02_25)] px-2.5 py-2">
            <PushPin
              size={13}
              weight="fill"
              className="mt-0.5 shrink-0 text-primary"
            />
            <p className="min-w-0 flex-1 text-xs leading-snug text-foreground/90">
              <span className="font-semibold text-primary/90">
                {pinned.username}
              </span>{" "}
              {pinned.content}
            </p>
            {isHost && (
              <button
                onClick={modUnpin}
                title="Unpin"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground/50">
              {isLive ? "No messages yet — say something!" : "Chat is offline"}
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="group animate-in fade-in slide-in-from-bottom-1 duration-200"
          >
            {msg.type === "join" || msg.type === "like" || msg.type === "stage" ? (
              // System rows — the room's pulse, not someone speaking.
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                {msg.type === "like" ? (
                  <Heart size={11} weight="fill" className="shrink-0 text-red-400" />
                ) : msg.type === "stage" ? (
                  <UsersThree
                    size={11}
                    weight="fill"
                    className="shrink-0 text-primary/70"
                  />
                ) : (
                  <HandWaving
                    size={11}
                    weight="fill"
                    className="shrink-0 text-muted-foreground/50"
                  />
                )}
                <span className="truncate text-[0.7rem] text-muted-foreground/60">
                  <span className="font-semibold text-muted-foreground/90">
                    {msg.username}
                  </span>{" "}
                  {msg.type === "like"
                    ? "liked this stream"
                    : msg.type === "stage"
                      ? msg.content
                      : "joined"}
                  {(msg.platform === "socials" ||
                    msg.platform === "worldspace") && (
                    <span className="ml-1.5 rounded-sm bg-sky-500/15 px-1 py-px text-[0.5rem] font-bold uppercase tracking-wide text-sky-400">
                      WorldSpace
                    </span>
                  )}
                </span>
              </div>
            ) : msg.type === "tip" ? (
              // A gift or a drop: one compact, glossy line — no border, a
              // soft gradient in the money's colour (amber for dollars,
              // violet for points) with a highlight across the top, and the
              // amount as a small solid pill at the end.
              <div
                className={cn(
                  "relative my-1 flex items-center gap-2 overflow-hidden rounded-[10px] py-1.5 pr-1.5 pl-2",
                  msg.tipCurrency === "PTS"
                    ? "bg-gradient-to-r from-violet-500/[0.18] to-violet-500/[0.06]"
                    : "bg-gradient-to-r from-amber-400/[0.2] to-amber-400/[0.06]"
                )}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.07] to-transparent" />
                <UserAvatar src={msg.avatar} name={msg.username} size={18} className="relative size-[18px] shrink-0" />
                <span className="relative min-w-0 flex-1 truncate text-xs">
                  <span className={cn("font-semibold", msg.tipCurrency === "PTS" ? "text-violet-200" : "text-amber-200")}>{msg.username}</span>
                  <span className="text-foreground/70"> {msg.content || "tipped"}</span>
                </span>
                {msg.emoji && <GiftArt emoji={msg.emoji} size={22} className="relative" />}
                <span
                  className={cn(
                    "relative flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                    msg.tipCurrency === "PTS" ? "bg-violet-400 text-neutral-950" : "bg-amber-300 text-neutral-950"
                  )}
                >
                  {msg.tipCurrency === "PTS"
                    ? `+${msg.tipAmount} pts`
                    : msg.tipCurrency === "USD" || !msg.tipCurrency
                      ? `$${msg.tipAmount}`
                      : `${msg.tipAmount} ${msg.tipCurrency}`}
                </span>
              </div>
            ) : msg.type === "reaction" ? (
              <div className="flex items-center gap-2 py-0.5">
                <UserAvatar
                  src={msg.avatar}
                  name={msg.username}
                  size={18}
                  className="size-4.5"
                />
                <span className="text-xs text-muted-foreground">
                  {msg.username}
                </span>
                <span className="text-base">{msg.emoji}</span>
              </div>
            ) : (
              <div
                className="relative flex gap-2 rounded-sm px-1 py-1 hover:bg-white/2"
                onClick={
                  // Tap-to-toggle keeps the tools reachable on touch, where
                  // there is no hover.
                  isHost && !msg.isMod
                    ? () =>
                        setModMenuFor((cur) =>
                          cur === msg.id ? null : msg.id
                        )
                    : undefined
                }
              >
                <UserAvatar
                  src={msg.avatar}
                  name={msg.username}
                  size={22}
                  className="mt-0.5 size-5.5"
                />
                <div className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        msg.isMod
                          ? "text-green-400"
                          : "text-foreground/80"
                      )}
                    >
                      {msg.username}
                    </span>
                    {msg.isMod && (
                      <ShieldStar
                        size={12}
                        weight="fill"
                        className="text-green-400"
                      />
                    )}
                    {(msg.platform === "socials" ||
                      msg.platform === "worldspace") && (
                      <span className="rounded-sm bg-sky-500/15 px-1 py-px text-[0.55rem] font-bold uppercase tracking-wide text-sky-400">
                        WorldSpace
                      </span>
                    )}
                    <span className="text-[0.6rem] text-muted-foreground/50">
                      {msg.timestamp}
                    </span>
                  </span>
                  <p className="break-words text-xs text-foreground/70">
                    {msg.content}
                  </p>
                </div>

                {/* Host tools — hover on desktop, tap-toggled on touch */}
                {isHost && !msg.isMod && (
                  <div
                    className={cn(
                      "absolute top-0.5 right-1 items-center gap-0.5 rounded-sm border border-white/10 bg-background/95 p-0.5 shadow-lg",
                      modMenuFor === msg.id
                        ? "flex"
                        : "hidden group-hover:flex"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => modPinMessage(msg.id)}
                      disabled={modBusy}
                      title="Pin message"
                      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50"
                    >
                      <PushPin size={12} />
                    </button>
                    <button
                      onClick={() => modDeleteMessage(msg.id)}
                      disabled={modBusy}
                      title="Delete message"
                      className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50"
                    >
                      <Trash size={12} />
                    </button>
                    {msg.userId && (
                      <>
                        <button
                          onClick={() => modBanUser(msg.userId!, 10)}
                          disabled={modBusy}
                          title="Timeout 10 minutes"
                          className="flex size-6 items-center justify-center rounded text-amber-400/80 transition-colors hover:bg-amber-500/10 hover:text-amber-400 disabled:opacity-50"
                        >
                          <Timer size={12} />
                        </button>
                        <button
                          onClick={() => modBanUser(msg.userId!)}
                          disabled={modBusy}
                          title="Ban from stream"
                          className="flex size-6 items-center justify-center rounded text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                        >
                          <Prohibit size={12} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Reactions popup */}
      {showReactions && (
        <div className="border-t border-white/5 bg-white/[0.02] px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                className="flex size-8 items-center justify-center rounded-sm text-lg transition-transform hover:scale-125 hover:bg-white/5"
              >
                {emoji}
              </button>
            ))}
          </div>
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

      {/* Input bar */}
      <div className="border-t border-white/5 px-3 py-3">
        {chatError && isLive && user && (
          <p className="mb-2 text-[0.65rem] text-red-400">{chatError}</p>
        )}
        {isLive && user && myBan ? (
          <div className="flex h-10 items-center justify-center gap-2 rounded-sm border border-red-500/20 bg-red-500/5 text-xs font-medium text-red-400">
            <Prohibit size={14} />
            {myBan.until
              ? `You're timed out until ${new Date(
                  myBan.until
                ).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "You've been banned from this chat"}
          </div>
        ) : isLive && !user ? (
          <a
            href="https://www.worldstreetgold.com/login"
            className="flex h-10 items-center justify-center gap-2 rounded-sm border border-white/10 bg-white/5 text-sm font-medium text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
          >
            <SignIn size={16} />
            Sign in to chat
          </a>
        ) : isLive ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowReactions(!showReactions);
                setShowGiftPanel(false);
              }}
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-sm transition-colors",
                showReactions
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <Smiley size={20} />
            </button>
            {!isHost && (
              <button
                onClick={() => {
                  setShowGiftPanel(!showGiftPanel);
                  setShowReactions(false);
                  setGiftError(null);
                }}
                title="Send a gift"
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-sm transition-colors",
                  showGiftPanel
                    ? "bg-yellow-500/10 text-yellow-400"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <Gift size={20} weight="fill" />
              </button>
            )}
            <input
              type="text"
              placeholder={
                cooldownLeft > 0
                  ? `Slow mode — wait ${cooldownLeft}s`
                  : slowMode && !isHost
                    ? `Slow mode (${SLOW_MODE_SECONDS}s between messages)`
                    : "Send a message..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              disabled={cooldownLeft > 0 || sending}
              className="h-10 flex-1 rounded-sm border border-white/10 bg-white/5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              onClick={sendMessage}
              disabled={cooldownLeft > 0 || sending}
              className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cooldownLeft > 0 ? (
                <span className="text-xs font-semibold">{cooldownLeft}</span>
              ) : sending ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <PaperPlaneRight size={18} weight="fill" />
              )}
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground/50">
            Chat is disabled — stream is offline
          </p>
        )}
      </div>
    </div>
  );
}
