"use client";

import { useEffect, useState } from "react";
import type { AppealView, TakedownView } from "@xtreme/contracts";
import { ShieldStar } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

export function TakedownRow({ row, onAppealed }: { row: TakedownView; onAppealed: (appeal: AppealView) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { appeal: AppealView } }>(`/api/streams/${row.streamId}/appeal`, {
        method: "POST",
        body: JSON.stringify({ text: text.trim() }),
      });
      onAppealed(r.data.appeal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(false);
    }
  };
  const a = row.appeal;
  return (
    <li className="rounded-[16px] bg-tint/[0.04] p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[15px] font-semibold">{row.title}</p>
        {a && (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11.5px] font-bold",
              a.status === "open" ? "bg-ember/15 text-ember-hi" : a.status === "reversed" ? "bg-tone-green text-tone-green-ink" : "bg-tint/[0.07] text-foreground/80"
            )}
          >
            {a.status === "open" ? "Under review" : a.status === "reversed" ? "Reversed" : "Upheld"}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">Taken down {day(row.takenDownAt)} after a report.</p>
      {!a ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Say why it should come back — what happened, and what the report missed."
            aria-label={`Appeal the takedown of ${row.title}`}
            className="mt-3 w-full resize-none rounded-[12px] bg-tint/[0.06] px-4 py-3 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-tint/[0.09]"
          />
          {error && <p className="mt-2 text-[12.5px] text-chili-hi">{error}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <Pill variant="primary" size="sm" onClick={() => void send()} disabled={busy || text.trim().length < 20}>
              {busy ? "Sending…" : "Send appeal"}
            </Pill>
            <p className="text-[12px] text-muted-foreground">One appeal per stream. A person on the team reads every one.</p>
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <p className="rounded-[12px] bg-background/60 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-foreground/85">{a.text}</p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {a.status === "open"
              ? "The team will look again and tell you what they decide."
              : a.status === "reversed"
                ? "The takedown was reversed — your stream's page is back."
                : "The takedown stands."}
            {a.note ? ` “${a.note}”` : ""}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Takedowns (Phase 3, deeper moderation): the creator's streams the
 * platform took down, and the way to appeal one — shown on Your channel
 * only when there's something to show.
 */
export function Takedowns() {
  const [rows, setRows] = useState<TakedownView[] | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch<{ success: boolean; data: { takedowns: TakedownView[] } }>("/api/users/me/takedowns")
      .then((r) => alive && setRows(r.data.takedowns))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section id="takedowns" aria-labelledby="takedowns-title" className={cn(TILE, "mt-3 scroll-mt-24 p-6 md:p-7")}>
      <p className={cn(EYEBROW, "flex items-center gap-1.5")}>
        <ShieldStar size={12} /> Trust &amp; safety
      </p>
      <h2 id="takedowns-title" className="mt-1.5 font-wide text-[20px] font-bold tracking-[-0.02em]">
        {rows.length === 1 ? "A stream was taken down" : `${rows.length} streams were taken down`}
      </h2>
      <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
        After a report, the team took these down under the community rules. If you think one got it wrong, appeal it — within 90 days.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((row) => (
          <TakedownRow
            key={row.streamId}
            row={row}
            onAppealed={(appeal) => setRows((cur) => (cur ?? []).map((x) => (x.streamId === row.streamId ? { ...x, appeal } : x)))}
          />
        ))}
      </ul>
    </section>
  );
}
