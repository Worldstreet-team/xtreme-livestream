"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChatCircle } from "@phosphor-icons/react";
import { MessagingError, type ThreadContext } from "@worldstreet/messaging-sdk";
import { cn } from "@/lib/utils";
import { messaging, threadHref } from "@/lib/messaging";

/**
 * "Message" beside "Ally" on a stream: opens (or finds) the one WorldSpace
 * thread with the streamer and goes there. `recipient` is the streamer's
 * Clerk id, which the gateway resolves to their messaging profile, making
 * one if they have never opened WorldSpace. `context` says what the thread
 * is about, the stream, so both sides see a chip that links back to it.
 */
export function MessageButton({
  recipient,
  context,
  className,
}: {
  recipient: string;
  context?: ThreadContext;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const thread = await messaging.conversations.open(recipient, context);
      router.push(threadHref(thread._id));
    } catch (err) {
      setError(
        err instanceof MessagingError && err.status !== 0
          ? err.message
          : "Messaging is unreachable right now",
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-60",
          className,
        )}
      >
        <ChatCircle size={16} />
        Message
      </button>
      {error && (
        <p className="max-w-[14rem] text-right text-[0.65rem] text-red-400">{error}</p>
      )}
    </div>
  );
}
