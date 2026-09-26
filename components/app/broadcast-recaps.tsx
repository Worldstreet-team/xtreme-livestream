"use client";

import { useRef, useState } from "react";
import { CaretRight } from "@/components/icons";
import { StreamRecap } from "@/components/app/stream-recap";
import { cn } from "@/lib/utils";

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/** What a recap needs from `RecentStream` — kept small on purpose. */
interface Broadcast {
  id: string;
  title: string;
  date: string;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Your channel used to recap only the last broadcast. Here every broadcast
 * in `streams` (the same last-10 the "Recent broadcasts" shelf lists) can
 * open its own — the tile stays put and swaps in place, so there's one
 * recap on screen at a time and only the one being viewed fetches analytics.
 * Opens to the latest; the list below is how you leave and how you come back.
 */
export function BroadcastRecaps({ streams }: { streams: Broadcast[] }) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const latest = streams[0];
  if (!latest) return null;

  const viewing = streams.find((s) => s.id === pickedId) ?? latest;
  const isLatest = viewing.id === latest.id;

  // A pick can be made from a row well below the tile it changes — bring
  // the tile back into view rather than leave the change off-screen.
  const open = (id: string) => {
    setPickedId(id === latest.id ? null : id);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mt-3">
      <div ref={topRef} className="scroll-mt-24">
        <StreamRecap
          streamId={viewing.id}
          title={viewing.title}
          eyebrow={isLatest ? "Recap · last broadcast" : `Recap · ${shortDate(viewing.date)}`}
          action={
            !isLatest && (
              <button type="button" onClick={() => open(latest.id)} className="text-[12.5px] font-semibold text-ember-hi hover:underline">
                Back to latest
              </button>
            )
          }
        />
      </div>

      {streams.length > 1 && (
        <div className="mt-3 rounded-[10px] bg-surface p-2">
          <p className={cn(EYEBROW, "px-2.5 pt-1.5 pb-2")}>Past broadcasts</p>
          <ul className="flex flex-col">
            {streams.map((s) => {
              const active = s.id === viewing.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => open(s.id)}
                    className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.045]"
                  >
                    <span aria-hidden className={cn("h-4 w-[3px] shrink-0 rounded-full", active ? "bg-ember" : "bg-transparent")} />
                    <span className={cn("min-w-[6.25rem] shrink-0 whitespace-nowrap text-[13px] tabular-nums", active ? "font-bold text-ember-hi" : "font-semibold text-foreground")}>
                      {shortDate(s.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{s.title}</span>
                    <CaretRight size={13} className="shrink-0 text-muted-foreground/40" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
