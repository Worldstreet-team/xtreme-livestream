"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ThreadContext } from "@worldstreet/messaging-sdk";
import { ChatCircleDots } from "@/components/icons";
import { Pill, PillLink } from "@/components/xtream";
import { Tip } from "@/components/ui/tip";
import { useAuth } from "@/lib/auth-context";
import { signInHref } from "@/lib/auth-urls";
import { messaging, openFailure, openThreadWith, threadHref } from "@/lib/messaging";

/**
 * "Message" beside Ally: opens (or finds) the one WorldSpace thread with
 * this person and goes there. Ally stays the page's one white action, so
 * this is the quiet control beside it.
 *
 * The gateway addresses people by their Clerk id. A caller that already has
 * it passes `recipient`; otherwise the button looks it up from the public
 * profile when pressed, so a page only has to know the username. `context`
 * says what the thread is about (a stream), and both sides see a chip that
 * links back to it.
 */
export function MessageButton({
  username,
  name,
  recipient,
  context,
  labeled = false,
  size = "md",
}: {
  /** The person to message. */
  username: string;
  /** How to call them in the accessible label; defaults to the handle. */
  name?: string;
  /** Their Clerk id, when the page already has it. */
  recipient?: string;
  context?: ThreadContext;
  /** Show the word "Message" beside the glyph. */
  labeled?: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nobody messages themselves.
  if (user && user.username.toLowerCase() === username.toLowerCase()) return null;

  const who = name || `@${username}`;
  const glyph = <ChatCircleDots size={size === "sm" ? 14 : 17} />;

  if (!user) {
    return (
      <Tip label={`Sign in to message ${who}`} disabled={labeled}>
        <PillLink
          external
          href={signInHref(pathname)}
          size={size}
          variant="glass"
          icon={glyph}
          iconOnly={!labeled}
          aria-label={`Sign in to message ${who}`}
        >
          Message
        </PillLink>
      </Tip>
    );
  }

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = recipient
        ? (await messaging.conversations.open(recipient, context))._id
        : await openThreadWith(username, context);
      router.push(threadHref(id));
    } catch (err) {
      setError(openFailure(err));
      setBusy(false);
    }
  };

  return (
    <span className="relative inline-flex">
      <Tip label={`Message ${who}`} disabled={labeled}>
        <Pill
          size={size}
          variant="glass"
          icon={
            busy ? (
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : (
              glyph
            )
          }
          iconOnly={!labeled}
          onClick={open}
          disabled={busy}
          aria-label={`Message ${who}`}
          className="shadow-none!"
        >
          Message
        </Pill>
      </Tip>
      {error && (
        <span
          role="status"
          className="absolute top-full right-0 z-10 mt-1.5 w-max max-w-[16rem] rounded-control bg-surface-raised px-2.5 py-1.5 text-[12px] leading-snug text-destructive shadow-lg"
        >
          {error}
        </span>
      )}
    </span>
  );
}
