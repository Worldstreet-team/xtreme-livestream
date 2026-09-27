"use client";

import { useState } from "react";
import { PencilSimple, Plus, Ticket, Warning } from "@/components/icons";
import type { AdminCampaign } from "@/components/app/admin/campaign-form";
import { Money, formatUsd } from "@/components/xtream/money";
import { fieldClass } from "@/components/ui/input";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { SPONSOR_CATEGORY_LABELS } from "@/lib/sponsors";
import { cn } from "@/lib/utils";

const TILE = "rounded-panel bg-surface";
type Envelope<T> = { success: boolean; data: T };

const STATUS: Record<AdminCampaign["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-tint/[0.08] text-foreground/80" },
  live: { label: "Live", cls: "bg-chili text-white" },
  paused: { label: "Paused", cls: "bg-warning/[0.16] text-warning" },
  ended: { label: "Ended", cls: "bg-tint/[0.06] text-muted-foreground" },
};

const ENDED: Record<AdminCampaign["endedReason"], string> = {
  "": "",
  admin: "Ended by the team",
  date: "Its end date passed",
  budget: "The pool ran out",
};

export function CampaignRow({
  campaign: c,
  onEdit,
  onChange,
  onError,
}: {
  campaign: AdminCampaign;
  onEdit: () => void;
  onChange: (c: AdminCampaign) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [codes, setCodes] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const spentShare = c.budgetUsdMinor > 0 ? Math.min(1, c.spentUsdMinor / c.budgetUsdMinor) : 0;

  const setStatus = async (status: "live" | "paused" | "ended") => {
    setBusy(status);
    onError(null);
    try {
      const r = await apiFetch<Envelope<{ campaign: AdminCampaign }>>(`/api/admin/campaigns/${c.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      onChange(r.data.campaign);
      setConfirmEnd(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't change that");
    } finally {
      setBusy(null);
    }
  };

  const addCodes = async () => {
    const list = (codes ?? "")
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (list.length === 0) return;
    setBusy("codes");
    onError(null);
    try {
      const r = await apiFetch<Envelope<{ added: number; skipped: number }>>(`/api/admin/campaigns/${c.id}/vouchers`, { method: "POST", body: JSON.stringify({ codes: list }) });
      setNote(`Added ${r.data.added}${r.data.skipped ? ` · ${r.data.skipped} already there` : ""}`);
      setCodes(null);
      onChange({ ...c, vouchers: { ...c.vouchers, total: c.vouchers.total + r.data.added } });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't add those codes");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className={cn(TILE, "p-5 md:p-6")}>
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-white p-1.5">
          {c.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the brand's logo, served versioned by the API
            <img src={apiUrl(c.logoUrl)} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="font-wide text-[22px] font-bold text-[#0b0708]">{c.name.charAt(0).toUpperCase()}</span>
          )}
        </span>
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-wide text-[19px] font-bold tracking-[-0.02em]">{c.name}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", STATUS[c.status].cls)}>{STATUS[c.status].label}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", c.restricted ? "bg-warning/[0.14] text-warning" : "bg-tint/[0.07] text-muted-foreground")}>
              {SPONSOR_CATEGORY_LABELS[c.category].label}
              {c.cleared && " · cleared for Nigeria"}
              {c.restricted && " · hidden in Nigeria"}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {c.line || "No line yet"}
            {c.status === "ended" && c.endedReason && ` · ${ENDED[c.endedReason]}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {c.status !== "ended" && (
            <button type="button" onClick={onEdit} className="press flex h-9 items-center gap-1.5 rounded-full bg-tint/[0.07] px-3.5 text-[12.5px] font-semibold hover:bg-tint/[0.11]">
              <PencilSimple size={14} />
              Edit
            </button>
          )}
          {(c.status === "draft" || c.status === "paused") && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void setStatus("live")}
              className="press flex h-9 items-center rounded-full bg-chili px-4 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {busy === "live" ? "Starting…" : c.status === "draft" ? "Go live" : "Resume"}
            </button>
          )}
          {c.status === "live" && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void setStatus("paused")}
              className="press flex h-9 items-center rounded-full bg-tint/[0.07] px-3.5 text-[12.5px] font-semibold hover:bg-tint/[0.11] disabled:opacity-50"
            >
              {busy === "paused" ? "Pausing…" : "Pause"}
            </button>
          )}
          {c.status !== "ended" &&
            (confirmEnd ? (
              <>
                <button type="button" disabled={busy !== null} onClick={() => void setStatus("ended")} className="press flex h-9 items-center rounded-full bg-chili px-3.5 text-[12.5px] font-semibold text-white">
                  End it — cards come down
                </button>
                <button type="button" onClick={() => setConfirmEnd(false)} className="press h-9 rounded-full px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
                  Keep
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmEnd(true)} className="press h-9 rounded-full px-3 text-[12.5px] font-semibold text-muted-foreground hover:bg-tint/[0.06] hover:text-foreground">
                End
              </button>
            ))}
        </div>
      </div>

      {/* The money: the pool, what's gone to creators, what the brand paid. */}
      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[14px] bg-tint/[0.04] p-4">
          <p className="flex items-baseline justify-between gap-2 text-[12px] text-muted-foreground">
            <span>Paid to creators</span>
            <span className="tabular-nums">
              {c.paidStreams} {c.paidStreams === 1 ? "stream" : "streams"} · {c.members} {c.members === 1 ? "creator" : "creators"}
            </span>
          </p>
          <p className="mt-2 flex items-baseline gap-1.5">
            <Money cents={c.spentUsdMinor} size="md" />
            <span className="text-[12.5px] text-muted-foreground">of {formatUsd(c.budgetUsdMinor)}</span>
          </p>
          <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-tint/[0.08]">
            <span className="block h-full rounded-full bg-value" style={{ width: `${spentShare * 100}%` }} />
          </span>
        </div>
        <div className="rounded-[14px] bg-tint/[0.04] p-4">
          <p className="text-[12px] text-muted-foreground">Brand prepaid</p>
          <p className="mt-2">
            <Money cents={c.brandPaidUsdMinor} size="md" tone="ink" />
          </p>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Xtream keeps {c.marginPercent}%</p>
        </div>
        <div className="rounded-[14px] bg-tint/[0.04] p-4">
          <p className="text-[12px] text-muted-foreground">A stream</p>
          <p className="mt-2">
            <Money cents={c.payPerStreamUsdMinor} size="md" />
          </p>
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            {c.minMinutes} min up{c.minViewers > 0 ? ` · ${c.minViewers.toLocaleString("en-US")}+ viewers` : ""} · {c.maxStreamsPerCreator} per creator
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground">
        {c.streamCategories.length > 0 && <span>For {c.streamCategories.join(", ")}</span>}
        {(c.startsAt || c.endsAt) && (
          <span>
            {c.startsAt ? new Date(c.startsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Now"} →{" "}
            {c.endsAt ? new Date(c.endsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "until the pool runs out"}
          </span>
        )}
        {c.quest ? (
          <span className="flex items-center gap-1.5 text-foreground/80">
            <Ticket size={13} weight="fill" className="text-ember-hi" />
            Quest: {c.quest.minutes} min → {c.quest.reward} · {c.vouchers.claimed} of {c.vouchers.total} vouchers claimed
          </span>
        ) : (
          <span>No sponsored quest</span>
        )}
      </div>

      {c.quest && c.status !== "ended" && (
        <div className="mt-4">
          {codes === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setCodes("")} className="press flex h-9 items-center gap-1.5 rounded-full bg-tint/[0.07] px-3.5 text-[12.5px] font-semibold hover:bg-tint/[0.11]">
                <Plus size={14} weight="bold" />
                Add voucher codes
              </button>
              {c.vouchers.total === c.vouchers.claimed && (
                <span className="flex items-center gap-1.5 text-[12.5px] text-warning">
                  <Warning size={13} weight="fill" />
                  {c.vouchers.total === 0 ? "No codes yet — viewers can't claim until you add some." : "Every code is claimed."}
                </span>
              )}
              {note && <span className="text-[12.5px] text-success">{note}</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <textarea
                autoFocus
                value={codes}
                onChange={(e) => setCodes(e.target.value)}
                rows={4}
                placeholder={"Paste the brand's codes — one per line\nOFADA-7K2M\nOFADA-9QX4"}
                aria-label="Voucher codes"
                className={cn(fieldClass, "resize-y px-4 py-3 font-mono text-[13px]")}
              />
              <div className="flex gap-2">
                <button type="button" disabled={busy !== null} onClick={() => void addCodes()} className="press flex h-9 items-center rounded-full bg-inverse px-4 text-[12.5px] font-semibold text-on-inverse disabled:opacity-50">
                  {busy === "codes" ? "Adding…" : "Add codes"}
                </button>
                <button type="button" onClick={() => setCodes(null)} className="press h-9 rounded-full px-3 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
