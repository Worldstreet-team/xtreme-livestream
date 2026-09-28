"use client";

import dynamic from "next/dynamic";
import { closeStreamReport, useStreamReportRequest } from "@/lib/stream-report";

/**
 * Where the post-live report opens: mounted once in the app shell beside
 * the studio (StudioHost), so a report opened from End outlives a studio
 * that closes behind it, and Your channel can open the same one. Its code
 * loads the first time a report is asked for.
 */
const StreamReportSheet = dynamic(() => import("./stream-report").then((m) => m.StreamReportSheet), { ssr: false });

export function StreamReportHost() {
  const request = useStreamReportRequest();
  if (!request) return null;
  return <StreamReportSheet key={request.streamId} request={request} onClose={closeStreamReport} />;
}
