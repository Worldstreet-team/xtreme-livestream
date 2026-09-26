"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { MessagesProvider } from "@/components/app/messages/messages-context";
import { InboxPane } from "@/components/app/messages/inbox";

/**
 * /messages: the inbox beside the open thread on a wide screen; one at a
 * time on anything narrower — the list at /messages, the thread at
 * /messages/:id, with a back arrow between them. One provider holds the
 * rows and the live events for both panes, so reading a thread clears its
 * count in the list without a second fetch.
 */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const inThread = pathname !== "/messages";

  return (
    <MessagesProvider enabled={Boolean(user)}>
      <div className="lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <aside
          aria-label="Conversations"
          className={cn(
            "min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:shadow-[inset_-1px_0_0_rgba(255,236,230,0.06)]",
            inThread && "hidden lg:block",
          )}
        >
          <InboxPane />
        </aside>
        <section className={cn("min-h-0 min-w-0", !inThread && "hidden lg:block")}>{children}</section>
      </div>
    </MessagesProvider>
  );
}
