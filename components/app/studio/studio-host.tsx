"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useLiveSession } from "@/lib/live-session";
import { StreamReportHost } from "@/components/app/stream-report-host";

/**
 * Where the studio lives: in the app shell, beside every page, rather than
 * on its route. On /studio it's the page; once you're live it stays mounted
 * wherever you go — its console out of sight, the broadcast minimized to a
 * corner (and on a wide screen, in the rail) — so browsing, checking your
 * channel or answering a message never takes you off the air. Before you go
 * live, leaving the studio closes it and hands the camera back.
 *
 * Loaded on demand: a viewer who never streams never downloads it.
 */
const Studio = dynamic(() => import("./studio").then((m) => m.Studio), {
  ssr: false,
  loading: () => <StudioLoading />,
});

export function StudioHost() {
  const pathname = usePathname();
  const onStudio = pathname === "/studio";
  const session = useLiveSession();
  return (
    <>
      {(onStudio || session) && <Studio minimized={!onStudio} />}
      {/* The post-live report: here, not in the studio, so it stays up when the studio closes. */}
      <StreamReportHost />
    </>
  );
}

/** The studio's frame while its code arrives: the stage, waiting. */
function StudioLoading() {
  return (
    <div aria-busy className="h-[100dvh] bg-black md:h-[calc(100dvh-4rem)] md:bg-background md:p-4">
      <div className="size-full animate-pulse bg-surface/40 md:rounded-[20px]" />
    </div>
  );
}
