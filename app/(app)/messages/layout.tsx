"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { MessagesProvider } from "@/components/app/messages/messages-context";
import { InboxPane } from "@/components/app/messages/inbox";
import { playBack, playPush } from "@/components/app/messages/push";

/**
 * /messages: the inbox beside the open thread on a wide screen; one at a
 * time on anything narrower — the list at /messages, the thread at
 * /messages/:id, with a back arrow between them. One provider holds the
 * rows and the live events for both panes, so reading a thread clears its
 * count in the list without a second fetch. One pane at a time, a thread
 * pushes in over the inbox from the right, and back runs it in reverse.
 */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const inThread = pathname !== "/messages";

  const asideRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);
  useLayoutEffect(() => {
    const was = lastPath.current;
    lastPath.current = pathname;
    if (was === "/messages" && pathname.startsWith("/messages/")) playPush(pathname.slice("/messages/".length), sectionRef.current);
    else if (was.startsWith("/messages/") && pathname === "/messages") playBack(asideRef.current);
  }, [pathname]);

  return (
    <MessagesProvider enabled={Boolean(user)}>
      <div className="lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <aside
          ref={asideRef}
          aria-label="Conversations"
          className={cn(
            "min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:shadow-[inset_-1px_0_0_var(--hairline-color)]",
            inThread && "hidden lg:block",
          )}
        >
          <InboxPane />
        </aside>
        <section ref={sectionRef} className={cn("min-h-0 min-w-0", !inThread && "hidden lg:block")}>
          {children}
        </section>
      </div>
    </MessagesProvider>
  );
}
