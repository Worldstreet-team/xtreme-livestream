import type { Metadata } from "next";
import { Recorder } from "@/components/app/recorder";

/** Egress's own page: never indexed, never linked. */
export const metadata: Metadata = { title: "Recording · Xtream", robots: { index: false, follow: false } };

/**
 * What LiveKit egress records for a broadcast's replay (services/api
 * recording.ts): the program, full frame, nothing else. Outside the app
 * shell, and outside sign-in entirely (middleware.ts) — the recorder's
 * headless browser has no account, and its room token is its key.
 */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Recorder streamId={id} />;
}
