"use client";

import { useState } from "react";
import { campaignBudgetMinor, isRestrictedSponsorCategory, type CampaignView, type SponsorCategory } from "@xtreme/contracts";
import { CategoryPicker, LogoPicker, normalizeLink } from "@/components/app/sponsor-form";
import { formatUsd } from "@/components/xtream/money";
import { TextField } from "@/components/ui/text-field";
import { fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A campaign as the platform's team sees it (GET /admin/campaigns). */
export interface AdminCampaign extends CampaignView {
  cleared: boolean;
  endedReason: "" | "admin" | "date" | "budget";
  brandPaidUsdMinor: number;
  marginPercent: number;
  budgetUsdMinor: number;
  spentUsdMinor: number;
  members: number;
  vouchers: { total: number; claimed: number };
  createdAt: string;
}

export interface CampaignDraft {
  name: string;
  line: string;
  url: string;
  code: string;
  category: SponsorCategory;
  logo?: string;
  brief: string;
  cleared: boolean;
  streamCategories: string[];
  payPerStreamUsdMinor: number;
  minMinutes: number;
  minViewers: number;
  maxStreamsPerCreator: number;
  brandPaidUsdMinor: number;
  marginPercent: number;
  startsAt: string | null;
  endsAt: string | null;
  quest: { minutes: number; reward: string } | null;
}

/** "2026-10-01T09:00" for a datetime-local field, in this browser's time. */
function localInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const dollars = (minor: number | undefined) => (minor === undefined ? "" : String(minor / 100));
const toMinor = (raw: string) => Math.round(Number(raw) * 100);

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-white/[0.06] pt-5 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="font-wide text-[15px] font-bold tracking-[-0.02em]">{title}</p>
        {note && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{note}</p>}
      </div>
      {children}
    </fieldset>
  );
}

/**
 * Set up or change an Xtream campaign: the brand and its card, what the
 * brand prepaid and the platform's margin (the creators' pool is worked
 * out, not typed), what a stream earns and what qualifies it, the dates,
 * and the sponsored quest viewers play for the brand's vouchers.
 */
export function CampaignForm({
  campaign,
  onSave,
  onCancel,
}: {
  campaign: AdminCampaign | null;
  onSave: (draft: CampaignDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(campaign?.name ?? "");
  const [line, setLine] = useState(campaign?.line ?? "");
  const [link, setLink] = useState(campaign?.url ?? "");
  const [code, setCode] = useState(campaign?.code ?? "");
  const [category, setCategory] = useState<SponsorCategory>(campaign?.category ?? "everyday");
  const [cleared, setCleared] = useState(campaign?.cleared ?? false);
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [brief, setBrief] = useState(campaign?.brief ?? "");
  const [brandPaid, setBrandPaid] = useState(dollars(campaign?.brandPaidUsdMinor));
  const [margin, setMargin] = useState(String(campaign?.marginPercent ?? 25));
  const [pay, setPay] = useState(dollars(campaign?.payPerStreamUsdMinor ?? 2000));
  const [minMinutes, setMinMinutes] = useState(String(campaign?.minMinutes ?? 10));
  const [minViewers, setMinViewers] = useState(String(campaign?.minViewers ?? 0));
  const [maxStreams, setMaxStreams] = useState(String(campaign?.maxStreamsPerCreator ?? 4));
  const [categories, setCategories] = useState((campaign?.streamCategories ?? []).join(", "));
  const [startsAt, setStartsAt] = useState(localInput(campaign?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(localInput(campaign?.endsAt ?? null));
  const [questOn, setQuestOn] = useState(Boolean(campaign?.quest));
  const [questMinutes, setQuestMinutes] = useState(String(campaign?.quest?.minutes ?? 10));
  const [questReward, setQuestReward] = useState(campaign?.quest?.reward ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const paidMinor = toMinor(brandPaid || "0");
  const marginPct = Math.min(90, Math.max(0, Math.round(Number(margin) || 0)));
  const payMinor = toMinor(pay || "0");
  const pool = campaignBudgetMinor(Number.isFinite(paidMinor) ? paidMinor : 0, marginPct);
  const streams = payMinor > 0 ? Math.floor(pool / payMinor) : 0;
  const restricted = isRestrictedSponsorCategory(category);

  const save = async () => {
    setError(null);
    const url = normalizeLink(link);
    if (!name.trim()) return setError("Name the brand.");
    if (url === null) return setError("That link doesn't look like a web address.");
    if (!/^[A-Za-z0-9_-]*$/.test(code.trim())) return setError("Promo codes use letters, numbers, - and _ only.");
    if (!Number.isFinite(paidMinor) || paidMinor < 0) return setError("Enter what the brand prepaid, in dollars.");
    if (!Number.isFinite(payMinor) || payMinor < 100) return setError("A stream pays at least $1.");
    if (campaign && pool < campaign.spentUsdMinor) return setError(`Creators have already been paid ${formatUsd(campaign.spentUsdMinor)} — the pool can't go below that.`);
    if (questOn && !questReward.trim()) return setError("Say what the quest's voucher is worth.");
    const start = startsAt ? new Date(startsAt).toISOString() : null;
    const end = endsAt ? new Date(endsAt).toISOString() : null;
    if (start && end && Date.parse(end) <= Date.parse(start)) return setError("The end has to come after the start.");
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        line: line.trim(),
        url,
        code: code.trim(),
        category,
        ...(logo !== undefined ? { logo } : {}),
        brief: brief.trim(),
        cleared: restricted && cleared,
        streamCategories: categories
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 20),
        payPerStreamUsdMinor: payMinor,
        minMinutes: Math.min(240, Math.max(1, Math.round(Number(minMinutes) || 10))),
        minViewers: Math.max(0, Math.round(Number(minViewers) || 0)),
        maxStreamsPerCreator: Math.min(100, Math.max(1, Math.round(Number(maxStreams) || 4))),
        brandPaidUsdMinor: paidMinor,
        marginPercent: marginPct,
        startsAt: start,
        endsAt: end,
        quest: questOn ? { minutes: Math.min(600, Math.max(1, Math.round(Number(questMinutes) || 10))), reward: questReward.trim() } : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the campaign — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-6"
    >
      <Group title="The brand" note="What the card says. Every card carries “Paid promotion”.">
        <LogoPicker current={campaign?.logoUrl ?? null} value={logo} onChange={setLogo} onError={setError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ofada Express" required />
          <TextField label="Promo code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={24} placeholder="XTREAM" />
        </div>
        <TextField label="Their line" value={line} onChange={(e) => setLine(e.target.value)} maxLength={80} placeholder="Food at your door in 30 minutes" />
        <TextField label="Link" value={link} onChange={(e) => setLink(e.target.value)} maxLength={300} inputMode="url" placeholder="ofadaexpress.com" />
        <CategoryPicker value={category} onChange={setCategory} />
        {restricted && (
          <label className="flex items-start gap-3 rounded-[12px] bg-warning/[0.08] p-3.5">
            <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ember)]" />
            <span className="text-[13px] leading-snug">
              <span className="font-semibold">Cleared for Nigeria</span>
              <span className="block text-muted-foreground">Only tick this once the promotion has SEC or ARCON clearance. Until then, viewers in Nigeria don&apos;t see the card or the quest.</span>
            </span>
          </label>
        )}
        <label className="flex flex-col gap-2">
          <span className="text-label font-medium">Brief for creators</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Mention the first-order code once an hour. No comparisons with other delivery apps."
            className={cn(fieldClass, "min-h-24 resize-y px-4 py-3")}
          />
        </label>
      </Group>

      <Group title="Money" note="The brand prepays WorldStreet; creators are paid from the pool.">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Brand prepaid ($)" value={brandPaid} onChange={(e) => setBrandPaid(e.target.value)} inputMode="decimal" placeholder="1000" required />
          <TextField label="Xtream keeps (%)" value={margin} onChange={(e) => setMargin(e.target.value)} inputMode="numeric" hint="20–30% is usual" />
          <TextField label="A stream pays ($)" value={pay} onChange={(e) => setPay(e.target.value)} inputMode="decimal" required />
        </div>
        <p className="rounded-[12px] bg-white/[0.04] px-4 py-3 text-[13px] leading-relaxed">
          Creators&apos; pool <span className="font-money text-value">{formatUsd(pool)}</span> — enough for{" "}
          <span className="font-semibold tabular-nums">{streams.toLocaleString("en-US")}</span> paid {streams === 1 ? "stream" : "streams"}.
          {campaign && campaign.spentUsdMinor > 0 && (
            <span className="text-muted-foreground"> {formatUsd(campaign.spentUsdMinor)} already paid out.</span>
          )}
        </p>
      </Group>

      <Group title="What earns a stream" note="Checked by the server: time on screen while live, and the stream's peak audience.">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Minutes on screen" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} inputMode="numeric" />
          <TextField label="Peak viewers at least" value={minViewers} onChange={(e) => setMinViewers(e.target.value)} inputMode="numeric" />
          <TextField label="Paid streams per creator" value={maxStreams} onChange={(e) => setMaxStreams(e.target.value)} inputMode="numeric" />
        </div>
        <TextField
          label="Stream categories"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          placeholder="Bitcoin Trading, Just Chatting"
          hint="Comma-separated. Empty means any stream."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} hint="Empty: as soon as it's live" />
          <TextField label="Ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} hint="Empty: when the pool runs out" />
        </div>
      </Group>

      <Group title="Sponsored quest" note="Viewers who watch while the card is up win one of the brand's vouchers — never points.">
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={questOn} onChange={(e) => setQuestOn(e.target.checked)} className="size-4 accent-[var(--ember)]" />
          <span className="text-[13.5px] font-medium">Run a quest with this campaign</span>
        </label>
        {questOn && (
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <TextField label="Minutes to watch" value={questMinutes} onChange={(e) => setQuestMinutes(e.target.value)} inputMode="numeric" />
            <TextField label="The prize" value={questReward} onChange={(e) => setQuestReward(e.target.value)} maxLength={80} placeholder="₦2,000 off your first order" />
          </div>
        )}
      </Group>

      {error && <p role="alert" className="rounded-[12px] bg-chili/[0.12] px-4 py-3 text-[13px] text-chili-hi">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="press flex h-11 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-[#0b0708] disabled:opacity-50">
          {saving ? "Saving…" : campaign ? "Save changes" : "Create draft"}
        </button>
        <button type="button" onClick={onCancel} className="press flex h-11 items-center rounded-full px-4 text-[14px] font-semibold text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}
