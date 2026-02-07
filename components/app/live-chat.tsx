"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  PaperPlaneRight,
  Smiley,
  CurrencyEth,
  ShieldStar,
  Prohibit,
  Clock,
  Lightning,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import type { Room } from "livekit-client";

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
  username: string;
  avatar: string;
  isMod?: boolean;
  content: string;
  type: "text" | "tip" | "reaction";
  tipAmount?: string;
  tipCurrency?: string;
  emoji?: string;
  timestamp: string;
}

interface LiveChatProps {
  streamId: string;
  room: Room | null;
  isLive: boolean;
}

export function LiveChat({ streamId, room, isLive }: LiveChatProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [showReactions, setShowReactions] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [tipAmount, setTipAmount] = useState("");
  const [tipCurrency, setTipCurrency] = useState("USDC");
  const [slowMode, setSlowMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);

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
          const data = JSON.parse(decoded) as ChatMsg;
          setMessages((prev) => [
            ...prev,
            { ...data, id: `rt-${Date.now()}-${Math.random()}` },
          ]);
        } catch {
          // Ignore malformed data
        }
      };

      room.on(RoomEvent.DataReceived, handleData);
      // Store for cleanup
      (room as unknown as Record<string, unknown>).__chatHandler = handleData;
    };

    setup();

    return () => {
      if (eventName && room) {
        const handler = (room as unknown as Record<string, unknown>).__chatHandler;
        if (handler) {
          room.off(eventName as Parameters<typeof room.off>[0], handler as Parameters<typeof room.off>[1]);
        }
      }
      attachedRef.current = false;
    };
  }, [room, user?.id]);

  // Broadcast message via LiveKit data messages
  const broadcastMessage = useCallback(
    (msg: ChatMsg) => {
      if (!room?.localParticipant) return;
      try {
        const data = new TextEncoder().encode(JSON.stringify(msg));
        room.localParticipant.publishData(data, { reliable: true });
      } catch {
        // Room may be disconnected
      }
    },
    [room]
  );

  const sendMessage = async () => {
    if (!input.trim() || !user) return;

    const msg: ChatMsg = {
      id: `local-${Date.now()}`,
      username: user.username,
      avatar: user.avatar,
      content: input.trim(),
      type: "text",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    // Add locally immediately
    setMessages((prev) => [...prev, msg]);
    setInput("");

    // Broadcast via LiveKit
    broadcastMessage(msg);

    // Persist to API (fire and forget)
    try {
      await apiFetch(`/api/streams/${streamId}/chat`, {
        method: "POST",
        body: JSON.stringify({ content: msg.content, type: "text" }),
      });
    } catch {
      // Best-effort persistence
    }
  };

  const sendReaction = async (emoji: string) => {
    if (!user) return;

    const msg: ChatMsg = {
      id: `local-${Date.now()}`,
      username: user.username,
      avatar: user.avatar,
      content: emoji,
      type: "reaction",
      emoji,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, msg]);
    setShowReactions(false);

    broadcastMessage(msg);

    try {
      await apiFetch(`/api/streams/${streamId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          content: emoji,
          type: "reaction",
          emoji,
        }),
      });
    } catch {
      // Best-effort
    }
  };

  const sendTip = async () => {
    if (!tipAmount || !user) return;

    const msg: ChatMsg = {
      id: `local-${Date.now()}`,
      username: user.username,
      avatar: user.avatar,
      content: "Sent a tip!",
      type: "tip",
      tipAmount,
      tipCurrency,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, msg]);
    setShowTipModal(false);

    broadcastMessage(msg);

    try {
      await apiFetch(`/api/streams/${streamId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          content: "Sent a tip!",
          type: "tip",
          tipAmount,
          tipCurrency,
        }),
      });
    } catch {
      // Best-effort
    }

    setTipAmount("");
  };

  return (
    <div className="flex h-full flex-col border-l border-white/5 bg-background">
      {/* Chat header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Live Chat</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSlowMode(!slowMode)}
            title="Slow Mode"
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors",
              slowMode
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
            )}
          >
            <Clock size={16} />
          </button>
          <button
            title="Mod Tools"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <ShieldStar size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-1 overflow-y-auto px-3 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
      >
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
            {msg.type === "tip" ? (
              <div className="my-1.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Image
                    src={msg.avatar}
                    alt={msg.username}
                    width={20}
                    height={20}
                    className="size-5 rounded-full"
                  />
                  <span className="text-xs font-semibold text-yellow-400">
                    {msg.username}
                  </span>
                  <span className="text-xs text-yellow-400/70">tipped</span>
                  <span className="text-xs font-bold text-yellow-300">
                    {msg.tipAmount} {msg.tipCurrency}
                  </span>
                  <CurrencyEth size={14} className="text-yellow-400" />
                </div>
              </div>
            ) : msg.type === "reaction" ? (
              <div className="flex items-center gap-2 py-0.5">
                <Image
                  src={msg.avatar}
                  alt={msg.username}
                  width={18}
                  height={18}
                  className="size-[18px] rounded-full"
                />
                <span className="text-xs text-muted-foreground">
                  {msg.username}
                </span>
                <span className="text-base">{msg.emoji}</span>
              </div>
            ) : (
              <div className="flex gap-2 rounded-md px-1 py-1 hover:bg-white/[0.02]">
                <Image
                  src={msg.avatar}
                  alt={msg.username}
                  width={22}
                  height={22}
                  className="mt-0.5 size-[22px] shrink-0 rounded-full"
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
                    <span className="text-[0.6rem] text-muted-foreground/50">
                      {msg.timestamp}
                    </span>
                  </span>
                  <p className="break-words text-xs text-foreground/70">
                    {msg.content}
                  </p>
                </div>
                <button
                  title="Ban user"
                  className="hidden size-5 shrink-0 items-center justify-center rounded text-muted-foreground/30 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
                >
                  <Prohibit size={12} />
                </button>
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
                className="flex size-8 items-center justify-center rounded-md text-lg transition-transform hover:scale-125 hover:bg-white/5"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tip modal */}
      {showTipModal && (
        <div className="border-t border-yellow-500/20 bg-yellow-500/5 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-yellow-400">
            Send a Crypto Tip
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Amount"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-yellow-500/30 focus:outline-none"
            />
            <select
              value={tipCurrency}
              onChange={(e) => setTipCurrency(e.target.value)}
              className="h-8 cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 text-xs text-foreground"
            >
              <option value="USDC">USDC</option>
              <option value="ETH">ETH</option>
              <option value="SOL">SOL</option>
              <option value="BTC">BTC</option>
            </select>
            <button
              onClick={sendTip}
              className="h-8 rounded-md bg-yellow-500/20 px-3 text-xs font-semibold text-yellow-400 transition-colors hover:bg-yellow-500/30"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="border-t border-white/5 px-3 py-3">
        {isLive ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowReactions(!showReactions);
                setShowTipModal(false);
              }}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                showReactions
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <Smiley size={18} />
            </button>
            <button
              onClick={() => {
                setShowTipModal(!showTipModal);
                setShowReactions(false);
              }}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors",
                showTipModal
                  ? "bg-yellow-500/10 text-yellow-400"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              <Lightning size={18} weight="fill" />
            </button>
            <input
              type="text"
              placeholder={
                slowMode ? "Slow mode (30s)" : "Send a message..."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/30 focus:outline-none"
            />
            <button
              onClick={sendMessage}
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors hover:bg-primary/20"
            >
              <PaperPlaneRight size={16} weight="fill" />
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
