"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, PencilSimple, Plus, Storefront, Ticket, Trash, Warning } from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { SponsorForm } from "@/components/app/sponsor-form";
import { Money } from "@/components/xtream/money";
import { apiUrl } from "@/lib/api-client";
import {
  linkLabel,
  MAX_SPONSORS,
  onScreenLabel,
  SPONSOR_CATEGORY_LABELS,
  UNPAID_REASONS,
  type CampaignView,
  type SponsorDraft,
  type Sponsorships,
  type SponsorRunView,
  type SponsorView,
} from "@/lib/sponsors";
import { cn } from "@/lib/utils";

/**
 * Sponsorships (Phase 2, sponsor slots), inside Your channel: the Xtream
 * campaigns you can join and what they've paid you, the brands you've made
 * your own deals with, and how long each card was on screen — the record
 * to show a brand. Every card says "Paid promotion"; that isn't yours to
 * turn off.
 */

const TILE = "rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * The Sponsorships page's body, from its data: campaigns to join, your own
 * sponsors, and the on-screen record.
 */
export function SponsorshipsView({
  data,
  failed,
  reload,
  saveSponsor,
  removeSponsor,
  setJoined,
}: {
  data: Sponsorships | null;
  failed: boolean;
  reload: () => Promise<void>;
  saveSponsor: (draft: SponsorDraft, id?: string) => Promise<unknown>;
  removeSponsor: (id: string) => Promise<void>;
  setJoined: (campaignId: string, join: boolean) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<SponsorView | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const joined = (data?.campaigns ?? []).filter((c) => c.joined);
  const earned = joined.reduce((sum, c) => sum + c.earnedUsdMinor, 0);

  return (
    <div className="min-h-screen px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[1080px]">
        <Link href="/dashboard" className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} weight="bold" />
          Your channel
        </Link>
        <header className="mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className={EYEBROW}>Your channel</p>
            <h1 className="mt-1.5 font-wide text-[clamp(2rem,4.2vw,3.2rem)] leading-[1] font-bold tracking-[-0.04em]">Sponsorships</h1>
            <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
              Run a brand&apos;s card while you&apos;re live — your own deals, or Xtream campaigns that pay you for it. Every card says
              &ldquo;Paid promotion&rdquo;, so viewers always know.
            </p>
          </div>
          {data && joined.length > 0 && (
            <div className="shrink-0 rounded-panel bg-surface px-5 py-4">
              <p className={EYEBROW}>From campaigns</p>
              <p className="mt-2 flex items-baseline gap-2">
                <Money cents={earned} size="lg" />
                <span className="text-[12.5px] text-muted-foreground">
                  across {joined.reduce((n, c) => n + c.paidStreams, 0)} paid {joined.reduce((n, c) => n + c.paidStreams, 0) === 1 ? "stream" : "streams"}
                </span>
              </p>
            </div>
          )}
        </header>

        {failed && !data ? (
          <div className={cn(TILE, "grid place-items-center px-6 py-16 text-center")}>
            <Warning size={26} className="text-chili-hi" />
            <p className="mt-3 font-wide text-[19px] font-bold tracking-[-0.02em]">Sponsorships didn&apos;t load</p>
            <button type="button" onClick={() => void reload()} className="press mt-5 h-10 rounded-full bg-white px-5 text-[14px] font-semibold text-[#0b0708]">
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-panel bg-surface" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            {error && <p className="rounded-[12px] bg-chili/[0.12] px-4 py-3 text-[13px] text-chili-hi">{error}</p>}

            {/* ── Xtream campaigns ─────────────────────────────────────── */}
            <section aria-labelledby="campaigns-title">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="campaigns-title" className="font-wide text-[22px] font-bold tracking-[-0.03em]">
                  Xtream campaigns
                </h2>
                <p className="text-[13px] text-muted-foreground">Brands pay through Xtream; you&apos;re paid per stream that runs the card.</p>
              </div>
              {data.campaigns.length === 0 ? (
                <div className={TILE}>
                  <Empty
                    icon={<Storefront size={28} />}
                    title="No campaigns running right now"
                    body="When a brand runs a campaign on Xtream, it shows up here for you to join."
                    goLive={false}
                  />
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {data.campaigns.map((c) => (
                    <CampaignCard
                      key={c.id}
                      campaign={c}
                      onJoin={async (join) => {
                        setError(null);
                        try {
                          await setJoined(c.id, join);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Couldn't do that — try again.");
                        }
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* ── Your own sponsors ────────────────────────────────────── */}
            <section aria-labelledby="own-title">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="own-title" className="font-wide text-[22px] font-bold tracking-[-0.03em]">
                    Your sponsors
                  </h2>
                  <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">
                    Deals you make yourself. The money stays between you and the brand — Xtream draws the card and keeps the label on it.
                  </p>
                </div>
                {editing === null && data.sponsors.length < MAX_SPONSORS && (
                  <button
                    type="button"
                    onClick={() => setEditing("new")}
                    className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-[13.5px] font-semibold text-[#0b0708]"
                  >
                    <Plus size={15} weight="bold" />
                    Add a sponsor
                  </button>
                )}
              </div>

              {editing === "new" && (
                <div className={cn(TILE, "mb-3 p-5 md:p-6")}>
                  <p className="mb-5 font-wide text-[17px] font-bold tracking-[-0.02em]">New sponsor</p>
                  <SponsorForm
                    sponsor={null}
                    onCancel={() => setEditing(null)}
                    onSave={async (draft) => {
                      await saveSponsor(draft);
                      setEditing(null);
                    }}
                  />
                </div>
              )}

              {data.sponsors.length === 0 && editing !== "new" ? (
                <div className={TILE}>
                  <Empty
                    icon={<Storefront size={28} />}
                    title="No sponsors of your own yet"
                    body="Add a brand you've made a deal with, and its card is one tap away in the studio's Scenes panel."
                    goLive={false}
                    action={{ label: "Add a sponsor", onClick: () => setEditing("new") }}
                  />
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.sponsors.map((s) =>
                    editing !== null && editing !== "new" && editing.id === s.id ? (
                      <li key={s.id} className={cn(TILE, "p-5 md:p-6")}>
                        <p className="mb-5 font-wide text-[17px] font-bold tracking-[-0.02em]">Edit {s.name}</p>
                        <SponsorForm
                          sponsor={s}
                          onCancel={() => setEditing(null)}
                          onSave={async (draft) => {
                            await saveSponsor(draft, s.id);
                            setEditing(null);
                          }}
                        />
                      </li>
                    ) : (
                      <SponsorRow
                        key={s.id}
                        sponsor={s}
                        onEdit={() => setEditing(s)}
                        onRemove={async () => {
                          setError(null);
                          try {
                            await removeSponsor(s.id);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Couldn't remove that — try again.");
                          }
                        }}
                      />
                    )
                  )}
                </ul>
              )}
            </section>

            {/* ── On screen ────────────────────────────────────────────── */}
            <section aria-labelledby="runs-title">
              <h2 id="runs-title" className="mb-1 font-wide text-[22px] font-bold tracking-[-0.03em]">
                On screen
              </h2>
              <p className="mb-4 text-[13px] text-muted-foreground">How long each card was up while you were live — the record to show a brand.</p>
              {data.runs.length === 0 ? (
                <p className={cn(TILE, "px-6 py-8 text-center text-[13.5px] text-muted-foreground")}>
                  Put a sponsor&apos;s card up from the studio&apos;s Scenes panel and its time on screen shows up here.
                </p>
              ) : (
                <ul className={cn(TILE, "divide-y divide-white/[0.05] px-2")}>
                  {data.runs.map((r) => (
                    <RunRow key={r.id} run={r} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Mark({ name, logoUrl, size = 48 }: { name: string; logoUrl: string | null; size?: number }) {
  return logoUrl ? (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-white p-1.5" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the brand's logo, served versioned by the API */}
      <img src={apiUrl(logoUrl)} alt="" className="max-h-full max-w-full object-contain" />
    </span>
  ) : (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-[12px] bg-ember font-wide text-[19px] font-bold text-on-ember" style={{ width: size, height: size }}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function CampaignCard({ campaign: c, onJoin }: { campaign: CampaignView; onJoin: (join: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const open = c.status === "live";
  const full = c.streamsLeft < 1;
  const act = async (join: boolean) => {
    setBusy(true);
    await onJoin(join);
    setBusy(false);
  };
  return (
    <li className={cn(TILE, "flex flex-col p-5", c.joined && "shadow-[inset_0_0_0_1.5px_var(--ember)]")}>
      <div className="flex items-start gap-3.5">
        <Mark name={c.name} logoUrl={c.logoUrl} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-wide text-[17px] font-bold tracking-[-0.02em]">{c.name}</span>
            {c.joined && (
              <span className="flex items-center gap-1 rounded-full bg-ember/[0.14] px-2 py-0.5 text-[11px] font-bold text-ember-hi">
                <Check size={11} weight="bold" />
                Joined
              </span>
            )}
            {!open && <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{c.status === "paused" ? "Paused" : "Ended"}</span>}
          </p>
          {c.line && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{c.line}</p>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-[12px] bg-white/[0.04] px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">A stream</dt>
          <dd className="mt-1">
            <Money cents={c.payPerStreamUsdMinor} size="sm" />
          </dd>
        </div>
        <div className="rounded-[12px] bg-white/[0.04] px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">On screen</dt>
          <dd className="mt-1 text-[14px] font-semibold tabular-nums">{c.minMinutes} min</dd>
        </div>
        <div className="rounded-[12px] bg-white/[0.04] px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{c.joined ? "Paid" : "Up to"}</dt>
          <dd className="mt-1 text-[14px] font-semibold tabular-nums">
            {c.joined ? `${c.paidStreams} of ${c.maxStreamsPerCreator}` : `${c.maxStreamsPerCreator} streams`}
          </dd>
        </div>
      </dl>

      {c.brief && <p className="mt-3.5 text-[13px] leading-relaxed text-foreground/80">{c.brief}</p>}

      <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
        {c.streamCategories.length > 0 && <li>For {c.streamCategories.join(", ")} streams.</li>}
        {c.minViewers > 0 && <li>Streams that reach {c.minViewers.toLocaleString("en-US")} viewers at their peak.</li>}
        {c.quest && (
          <li className="flex items-start gap-1.5 text-foreground/80">
            <Ticket size={13} weight="fill" className="mt-px shrink-0 text-ember-hi" />
            Your viewers can win: {c.quest.reward}
          </li>
        )}
        {c.restricted && (
          <li className="flex items-start gap-1.5 text-warning">
            <Warning size={13} weight="fill" className="mt-px shrink-0" />
            Kept off screens in Nigeria ({SPONSOR_CATEGORY_LABELS[c.category].label.toLowerCase()}).
          </li>
        )}
      </ul>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
        {c.joined ? (
          <>
            <p className="text-[12.5px] text-muted-foreground">
              {c.earnedUsdMinor > 0 ? (
                <>
                  <Money cents={c.earnedUsdMinor} size="sm" /> earned
                </>
              ) : (
                "Put its card up from the studio's Scenes panel."
              )}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(false)}
              className="press h-9 rounded-full px-3.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-50"
            >
              Leave
            </button>
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-muted-foreground">{full ? "Fully booked" : `${c.streamsLeft} ${c.streamsLeft === 1 ? "stream" : "streams"} left in its budget`}</p>
            <button
              type="button"
              disabled={busy || !open || full}
              onClick={() => void act(true)}
              className="press h-9 rounded-full bg-white px-4 text-[12.5px] font-semibold text-[#0b0708] disabled:opacity-40"
            >
              {busy ? "Joining…" : "Join"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function SponsorRow({ sponsor: s, onEdit, onRemove }: { sponsor: SponsorView; onEdit: () => void; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={cn(TILE, "flex flex-wrap items-center gap-x-4 gap-y-3 p-4")}>
      <div className="flex min-w-0 flex-1 basis-[15rem] items-center gap-3">
        <Mark name={s.name} logoUrl={s.logoUrl} size={44} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{s.name}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.restricted ? "bg-warning/[0.14] text-warning" : "bg-white/[0.07] text-muted-foreground")}>
              {SPONSOR_CATEGORY_LABELS[s.category].label}
            </span>
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {[s.line, s.url && linkLabel(s.url), s.code && `Code ${s.code}`].filter(Boolean).join(" · ") || "No line or link yet"}
          </p>
        </div>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-muted-foreground">Remove {s.name}? Its card comes down if it&apos;s up.</span>
          <button type="button" onClick={() => void onRemove()} className="press h-8 rounded-full bg-chili px-3.5 text-[12px] font-semibold text-white">
            Remove
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="press h-8 rounded-full px-3 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
            Keep
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="press flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-[12.5px] font-semibold transition-colors hover:bg-white/[0.11]"
          >
            <PencilSimple size={14} />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${s.name}`}
            className="press flex size-9 items-center justify-center rounded-full bg-white/[0.07] text-muted-foreground transition-colors hover:bg-white/[0.11] hover:text-foreground"
          >
            <Trash size={15} />
          </button>
        </div>
      )}
    </li>
  );
}

function RunRow({ run: r }: { run: SponsorRunView }) {
  const when = new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-3.5">
      <div className="min-w-0 flex-1 basis-[14rem]">
        <p className="truncate text-[14px] font-semibold">
          {r.name}
          <span className="font-normal text-muted-foreground"> on </span>
          {r.streamTitle ? (
            <Link href={`/stream/${r.streamId}`} className="hover:underline">
              {r.streamTitle}
            </Link>
          ) : (
            "a stream"
          )}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground tabular-nums">
          {when} · up {onScreenLabel(r.seconds)}
          {r.minMinutes ? ` of ${r.minMinutes} min needed` : ""}
        </p>
      </div>
      <RunStatus run={r} />
    </li>
  );
}

function RunStatus({ run: r }: { run: SponsorRunView }) {
  if (r.status === "paid") return <Money cents={r.payUsdMinor} size="sm" />;
  if (r.status === "none") return <span className="text-[12.5px] text-muted-foreground">Your deal</span>;
  if (r.status === "counting" || r.status === "paying") return <span className="text-[12.5px] font-semibold text-ember-hi">Counting</span>;
  return <span className="text-[12.5px] text-muted-foreground">{r.unpaidReason ? UNPAID_REASONS[r.unpaidReason] : "Not paid"}</span>;
}
