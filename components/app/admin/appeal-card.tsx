"use client";

import { useState } from "react";
import Link from "next/link";
import type { AppealView } from "@xtreme/contracts";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * One appeal against a takedown (Phase 3, deeper moderation): whose, the
 * stream, their words, and the decision — reverse or uphold, with a note
 * the creator reads. Admins only.
 */

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export function AppealCard({ appeal, onDecided }: { appeal: AppealView; onDecided: (a: AppealView) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"reverse" | "uphold" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "reverse" | "uphold") => {
    setBusy(decision);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { appeal: AppealView } }>(`/api/admin/appeals/${appeal.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      onDecided({ ...appeal, ...r.data.appeal });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  };
  const open = appeal.status === "open";
  return (
    <li className="rounded-panel bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 font-wide text-[17px] font-bold tracking-[-0.02em]">{appeal.stream.title}</p>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11.5px] font-bold",
            open ? "bg-ember/15 text-ember-hi" : appeal.status === "reversed" ? "bg-tone-green text-tone-green-ink" : "bg-tint/[0.07] text-foreground/80"
          )}
        >
          {open ? "Waiting" : appeal.status === "reversed" ? "Reversed" : "Upheld"}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {appeal.creator ? (
          <Link href={`/c/${appeal.creator.username}`} className="font-semibold text-foreground/85 hover:underline">
            {appeal.creator.displayName || appeal.creator.username}
          </Link>
        ) : (
          "A creator"
        )}{" "}
        · taken down {when(appeal.stream.takenDownAt)} · appealed {when(appeal.createdAt)}
      </p>
      <blockquote className="mt-3 rounded-[12px] bg-tint/[0.04] px-4 py-3 text-[14px] leading-relaxed whitespace-pre-line">{appeal.text}</blockquote>
      {open ? (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="A note for the creator (optional) — why, in a sentence"
            aria-label="A note for the creator"
            className="mt-3 w-full resize-none rounded-[12px] bg-tint/[0.06] px-4 py-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-tint/[0.09]"
          />
          {error && <p className="mt-2 text-[12.5px] text-chili-hi">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill variant="primary" onClick={() => void decide("reverse")} disabled={busy !== null}>
              {busy === "reverse" ? "Reversing…" : "Reverse — bring it back"}
            </Pill>
            <Pill variant="glass" onClick={() => void decide("uphold")} disabled={busy !== null}>
              {busy === "uphold" ? "Upholding…" : "Uphold the takedown"}
            </Pill>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Decided {when(appeal.reviewedAt)}
          {appeal.note ? ` — “${appeal.note}”` : ""}
        </p>
      )}
    </li>
  );
}

