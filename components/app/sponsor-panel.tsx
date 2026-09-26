"use client";

import { useState } from "react";
import { ArrowSquareOut, Check, Copy, Ticket, Timer } from "@/components/icons";
import { SIGN_IN_URL } from "@/lib/auth-urls";
import { apiUrl } from "@/lib/api-client";
import { linkLabel, type SponsoredQuestView } from "@/lib/sponsors";
import type { SceneLayer } from "@/lib/scene";
import { cn } from "@/lib/utils";

type SponsorLayer = Extract<SceneLayer, { kind: "sponsor" }>;

/** A code the viewer takes to the brand's checkout — tap to copy. */
function CopyCode({ code, label = "Code", tone = "dark" }: { code: string; label?: string; tone?: "dark" | "value" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      aria-label={`Copy ${label.toLowerCase()} ${code}`}
      className={cn(
        "press flex h-9 max-w-full shrink-0 items-center gap-2 rounded-full pr-3 pl-3.5 text-[12.5px] font-semibold transition-colors",
        tone === "value" ? "bg-value/[0.14] text-value hover:bg-value/[0.2]" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]"
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono font-bold tracking-[0.02em]">{code}</span>
      {copied ? <Check size={14} weight="bold" className="shrink-0 text-success" /> : <Copy size={14} className="shrink-0 opacity-70" />}
    </button>
  );
}

/** The brand's mark: its logo on white, or its initial in Ember. */
function Mark({ name, logoUrl, size = 44 }: { name: string; logoUrl: string | null; size?: number }) {
  return logoUrl ? (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-white p-1" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the sponsor's logo, served versioned by the API */}
      <img src={apiUrl(logoUrl)} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  ) : (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-ember font-wide text-[18px] font-bold text-on-ember"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Minutes toward a quest, as a flat bar. */
function Progress({ value, max }: { value: number; max: number }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label="Minutes watched"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
    >
      <span className="block h-full rounded-full bg-ember transition-[width] duration-500 ease-out" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/**
 * The quest's call: sign in, keep watching, claim, or the code once won.
 * Shared by the panel under the player and the phone's sheet.
 */
function QuestAction({
  quest,
  signedIn,
  claiming,
  onClaim,
}: {
  quest: SponsoredQuestView;
  signedIn: boolean;
  claiming: boolean;
  onClaim: () => void;
}) {
  if (quest.voucher) return <CopyCode code={quest.voucher.code} label="Your voucher" tone="value" />;
  if (!signedIn) {
    return (
      <a href={SIGN_IN_URL} className="press flex h-9 shrink-0 items-center rounded-full bg-white px-4 text-[12.5px] font-semibold text-[#0b0708]">
        Sign in to play
      </a>
    );
  }
  const done = quest.progress >= quest.minutes;
  if (done && !quest.vouchersLeft) return <span className="text-[12.5px] font-semibold text-muted-foreground">Every voucher&apos;s been claimed</span>;
  if (!done) {
    // Not a button yet: the minutes are counted as you watch.
    return (
      <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-[12.5px] font-semibold text-foreground/75 tabular-nums">
        <Timer size={14} />
        {quest.minutes - quest.progress} min to go
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={claiming}
      onClick={onClaim}
      className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ember px-4 text-[12.5px] font-bold text-on-ember transition-opacity disabled:opacity-60"
    >
      {claiming ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Ticket size={14} weight="fill" />}
      Claim voucher
    </button>
  );
}

function QuestBlock({
  sponsorName,
  quest,
  signedIn,
  claiming,
  error,
  onClaim,
}: {
  sponsorName: string;
  quest: SponsoredQuestView;
  signedIn: boolean;
  claiming: boolean;
  error: string | null;
  onClaim: () => void;
}) {
  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.1em] text-ember-hi uppercase">
            <Ticket size={13} weight="fill" />
            Sponsored quest
          </p>
          <p className="mt-1.5 text-[14px] leading-snug font-semibold text-foreground text-balance">{quest.reward}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            Watch {quest.minutes} minutes while {sponsorName}&apos;s card is up, on any stream running it.
          </p>
          {!quest.voucher && signedIn && (
            <div className="mt-2.5 flex items-center gap-3">
              <Progress value={quest.progress} max={quest.minutes} />
              <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground tabular-nums">
                {quest.progress}/{quest.minutes} min
              </span>
            </div>
          )}
        </div>
        <QuestAction quest={quest} signedIn={signedIn} claiming={claiming} onClaim={onClaim} />
      </div>
      {error && <p className="mt-2 text-[12px] text-chili-hi">{error}</p>}
    </div>
  );
}

/**
 * The sponsor on the stream, under the player: who's paying for the
 * promotion, their line, a code to copy and the way to them — and, for an
 * Xtream campaign with a sponsored quest, your minutes toward the prize.
 */
export function SponsorPanel({
  sponsor,
  quest,
  signedIn,
  claiming,
  error,
  onClaim,
  className,
}: {
  sponsor: SponsorLayer;
  quest: SponsoredQuestView | null;
  signedIn: boolean;
  claiming: boolean;
  error: string | null;
  onClaim: () => void;
  className?: string;
}) {
  return (
    <section aria-label={`Paid promotion: ${sponsor.name}`} className={cn("rounded-panel bg-surface p-4 md:p-5", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-3">
          <Mark name={sponsor.name} logoUrl={sponsor.logoUrl} />
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span className="truncate font-wide text-[16px] font-bold tracking-[-0.02em]">{sponsor.name}</span>
              <span className="shrink-0 rounded-[5px] bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-foreground/75 uppercase">
                Paid promotion
              </span>
            </p>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {sponsor.line || (sponsor.source === "campaign" ? "An Xtream campaign" : "The creator's sponsor")}
            </p>
          </div>
        </div>
        {/* One row on a phone too: the link gives way before the code does. */}
        {(sponsor.code || sponsor.url) && (
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            {sponsor.code && <CopyCode code={sponsor.code} />}
            {sponsor.url && (
              <a
                href={sponsor.url}
                target="_blank"
                rel="sponsored noopener noreferrer"
                className="press flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[12.5px] font-semibold text-[#0b0708] sm:flex-none"
              >
                <span className="truncate">{linkLabel(sponsor.url).split("/")[0]}</span>
                <ArrowSquareOut size={14} weight="bold" className="shrink-0" />
              </a>
            )}
          </div>
        )}
      </div>
      {quest && <QuestBlock sponsorName={sponsor.name} quest={quest} signedIn={signedIn} claiming={claiming} error={error} onClaim={onClaim} />}
    </section>
  );
}
