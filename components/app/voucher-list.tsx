"use client";

import { useState } from "react";
import { Check, Copy, Ticket } from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { apiUrl } from "@/lib/api-client";
import type { SponsoredQuestView } from "@/lib/sponsors";

function when(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Vouchers: the brands' prizes from sponsored quests — the codes you've
 * won, and the quests still running with your minutes toward each.
 */
export function VoucherList({
  quests,
  onClaim,
  emptyClassName,
}: {
  quests: SponsoredQuestView[] | null;
  onClaim: (campaignId: string) => Promise<void>;
  /** The empty state's tray, to match the list it sits in. */
  emptyClassName?: string;
}) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (quests === null) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-sm bg-tint/[0.04]" />
        ))}
      </div>
    );
  }
  if (quests.length === 0) {
    return (
      <Empty
        className={emptyClassName}
        icon={<Ticket size={26} />}
        title="No vouchers yet"
        body="Sponsored quests pay in the brand's own vouchers — never points. Watch a stream while a sponsor's card is up to play."
      />
    );
  }
  const won = quests.filter((q) => q.voucher);
  const going = quests.filter((q) => !q.voucher);
  return (
    <div className="flex flex-col gap-5">
      {error && <p className="rounded-sm bg-red-500/[0.12] px-3 py-2 text-[12.5px] text-chili-hi">{error}</p>}
      {won.length > 0 && (
        <div className="flex flex-col gap-1">
          {won.map((q) => (
            <div key={q.campaignId} className="flex flex-wrap items-center gap-3 rounded-sm px-2.5 py-2.5">
              <VoucherMark quest={q} />
              <span className="flex min-w-0 flex-1 basis-[12rem] flex-col leading-tight">
                <span className="truncate text-[14px] font-medium text-foreground">{q.reward}</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {q.name} · won {when(q.voucher!.claimedAt)}
                </span>
              </span>
              <VoucherCode code={q.voucher!.code} />
            </div>
          ))}
        </div>
      )}
      {going.length > 0 && (
        <div>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground/70 uppercase">Quests running</p>
          <div className="flex flex-col gap-1">
            {going.map((q) => {
              const done = q.progress >= q.minutes;
              return (
                <div key={q.campaignId} className="flex flex-wrap items-center gap-3 rounded-sm px-2.5 py-2.5">
                  <VoucherMark quest={q} />
                  <span className="flex min-w-0 flex-1 basis-[12rem] flex-col leading-tight">
                    <span className="truncate text-[14px] font-medium text-foreground">{q.reward}</span>
                    <span className="truncate text-[12px] text-muted-foreground">
                      Watch {q.minutes} min while {q.name}&apos;s card is up · {q.progress}/{q.minutes} so far
                    </span>
                  </span>
                  {done && q.vouchersLeft ? (
                    <button
                      type="button"
                      disabled={claiming !== null}
                      onClick={async () => {
                        setClaiming(q.campaignId);
                        setError(null);
                        try {
                          await onClaim(q.campaignId);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Couldn't claim that — try again.");
                        } finally {
                          setClaiming(null);
                        }
                      }}
                      className="flex h-9 shrink-0 items-center rounded-full bg-ember px-4 text-[12.5px] font-bold text-on-ember disabled:opacity-50"
                    >
                      {claiming === q.campaignId ? "Claiming…" : "Claim voucher"}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[12px] text-muted-foreground">{done ? "All claimed" : `${q.minutes - q.progress} min to go`}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="px-2.5 text-[11.5px] text-muted-foreground/60">Sponsored quests are paid promotion: the brands run them through Xtream.</p>
    </div>
  );
}

function VoucherMark({ quest }: { quest: SponsoredQuestView }) {
  return quest.logoUrl ? (
    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- the brand's logo, served versioned by the API */}
      <img src={apiUrl(quest.logoUrl)} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  ) : (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-400/[0.14] text-warning">
      <Ticket size={18} weight="fill" />
    </span>
  );
}

function VoucherCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        })
      }
      aria-label={`Copy voucher ${code}`}
      className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-amber-400/[0.12] px-3.5 font-mono text-[12.5px] font-bold text-warning transition-colors hover:bg-amber-400/[0.18]"
    >
      {code}
      {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
    </button>
  );
}
