"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChatText, Clock, VideoCamera } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * One report in the admin queue (safety kit): its 48-hour clock as a bar
 * and a countdown, what was reported — a stream, or a chat line with its
 * words kept — and the two ways to close it. Taking content down asks
 * once more, and says exactly what will happen.
 */

const WINDOW_MS = 48 * 60 * 60 * 1000;

export interface ReportRow {
  id: string;
  reason: string;
  details: string;
  status: "open" | "reviewed" | "actioned" | "dismissed";
  createdAt: string;
  dueAt: string;
  overdue: boolean;
  resolvedAt: string | null;
  note: string;
  reports: number;
  stream: { id: string; title: string; isLive: boolean; takenDown: boolean };
  host: { username: string; displayName: string; avatar: string } | null;
  reporter: { username: string } | null;
  message: { id: string; username: string; content: string } | null;
}

export const REASONS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate_speech: "Hate speech",
  violence: "Violence or threats",
  sexual_content: "Sexual content",
  scam_or_fraud: "Scam or fraud",
  copyright: "Copyright",
  other: "Something else",
};

export function span(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function ago(iso: string, now: number) {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** One report: its clock, what was reported, and the two ways to close it. */
export function ReportCard({ row, now, onResolved }: { row: ReportRow; now: number; onResolved: () => void }) {
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"takedown" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const due = new Date(row.dueAt).getTime();
  const left = due - now;
  const late = row.status === "open" && left < 0;
  const used = Math.min(1, Math.max(0, 1 - left / WINDOW_MS));
  const urgent = row.status === "open" && left < 6 * 3_600_000;

  const resolve = async (action: "takedown" | "dismiss") => {
    setBusy(action);
    setError(null);
    try {
      await apiFetch(`/api/admin/reports/${row.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resolve that");
      setBusy(null);
      setConfirming(false);
    }
  };

  return (
    <li className="overflow-hidden rounded-panel bg-surface">
      {/* The clock, as a bar: how much of the 48 hours is gone. */}
      {row.status === "open" && (
        <div aria-hidden className="h-1 bg-tint/[0.05]">
          <div className={cn("h-full transition-[width] duration-700", late ? "bg-chili" : urgent ? "bg-ember" : "bg-tint/25")} style={{ width: `${used * 100}%` }} />
        </div>
      )}
      <div className="p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-tint/[0.07] px-2.5 py-1 text-[12px] font-semibold">{REASONS[row.reason] ?? row.reason}</span>
          {row.reports > 1 && (
            <span className="rounded-full bg-chili/[0.14] px-2.5 py-1 text-[12px] font-semibold text-chili-hi tabular-nums">
              {row.reports} reports
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-[12.5px] font-semibold tabular-nums">
            {row.status === "open" ? (
              <span className={cn("flex items-center gap-1.5", late ? "text-chili-hi" : urgent ? "text-ember-hi" : "text-muted-foreground")}>
                <Clock size={14} />
                {late ? `Overdue by ${span(-left)}` : `${span(left)} left`}
              </span>
            ) : (
              <span className={row.status === "actioned" ? "text-chili-hi" : "text-muted-foreground"}>
                {row.status === "actioned" ? "Taken down" : "Dismissed"}
                {row.resolvedAt && ` · ${ago(row.resolvedAt, now)}`}
              </span>
            )}
          </span>
        </div>

        {/* What was reported. */}
        <div className="mt-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tint/[0.06] text-muted-foreground">
            {row.message ? <ChatText size={17} /> : <VideoCamera size={17} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] leading-snug">
              {row.message ? "A chat line in " : "The stream "}
              <Link href={`/stream/${row.stream.id}`} className="font-semibold underline-offset-2 hover:underline">
                {row.stream.title}
              </Link>
              {row.host && <span className="text-muted-foreground"> by @{row.host.username}</span>}
              {row.stream.isLive && <span className="ml-2 rounded-[4px] bg-chili px-1.5 py-px align-[2px] text-[10px] font-bold text-white">LIVE</span>}
              {row.stream.takenDown && <span className="ml-2 text-[12px] text-muted-foreground">(taken down)</span>}
            </p>
            {row.message && (
              <blockquote className="mt-2.5 rounded-[12px] bg-tint/[0.04] px-4 py-3 text-[14px] leading-relaxed break-words">
                <span className="mr-1.5 font-semibold">{row.message.username}</span>
                <span className="text-foreground/90">{row.message.content}</span>
              </blockquote>
            )}
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Reported by @{row.reporter?.username ?? "someone"} · {ago(row.createdAt, now)}
              {row.details && <span className="text-foreground/80"> — “{row.details}”</span>}
            </p>
            {row.note && <p className="mt-1 text-[12.5px] text-muted-foreground">Note: {row.note}</p>}
          </div>
        </div>

        {row.status === "open" && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="A note for the record (optional)"
              aria-label="A note for the record"
              className="h-10 min-w-0 flex-1 basis-56 rounded-full bg-tint/[0.06] px-4 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-tint/[0.09]"
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void resolve("dismiss")}
              className="press h-10 rounded-full bg-tint/[0.07] px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-tint/[0.11] disabled:opacity-50"
            >
              {busy === "dismiss" ? "Dismissing…" : "Keep it up"}
            </button>
            {confirming ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void resolve("takedown")}
                className="press flex h-10 items-center gap-1.5 rounded-full bg-chili px-4 text-[13px] font-bold text-white disabled:opacity-50"
              >
                {busy === "takedown" ? "Taking down…" : row.message ? "Delete the line" : row.stream.isLive ? "End the stream now" : "Take it down"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="press h-10 rounded-full bg-chili/[0.15] px-4 text-[13px] font-bold text-chili-hi transition-colors hover:bg-chili/25"
              >
                Take down…
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-[12.5px] text-chili-hi">{error}</p>}
      </div>
      {row.status === "open" && confirming && (
        <p className="flex items-center gap-2 bg-chili/[0.08] px-5 py-2.5 text-[12.5px] text-chili-hi md:px-6">
          <ArrowUpRight size={13} className="rotate-90" />
          {row.message
            ? "The line is deleted everywhere, and taken off screen if it's up."
            : row.stream.isLive
              ? "The stream ends now, its room closes, and it's kept out of every list. The creator is told."
              : "The stream is kept out of every list. The creator is told."}
        </p>
      )}
    </li>
  );
}
