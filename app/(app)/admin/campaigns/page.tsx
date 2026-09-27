"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldStar, Storefront } from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { AdminTabs } from "@/components/app/admin/admin-tabs";
import { CampaignForm, type AdminCampaign, type CampaignDraft } from "@/components/app/admin/campaign-form";
import { CampaignRow } from "@/components/app/admin/campaign-row";
import { formatUsd } from "@/components/xtream/money";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * Xtream campaigns (Phase 2, sponsor slots): the platform's team sets each
 * one up from a brand's brief — the team, not the brand, so every ad is
 * vetted before it airs. The brand prepays; creators opt in and are paid
 * from the pool per qualifying stream; a sponsored quest pays viewers in
 * the brand's vouchers. Platform admins only (ADMIN_USERNAMES).
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const TILE = "rounded-panel bg-surface";

type Envelope<T> = { success: boolean; data: T };

export default function CampaignsPage() {
  const { user, isLoading } = useAuth();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<AdminCampaign[] | null>(null);
  const [editing, setEditing] = useState<AdminCampaign | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiFetch<Envelope<{ admin: boolean }>>("/api/admin/me")
      .then((r) => !cancelled && setAdmin(r.data.admin))
      .catch(() => !cancelled && setAdmin(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<Envelope<{ campaigns: AdminCampaign[] }>>("/api/admin/campaigns");
      setRows(r.data.campaigns);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The campaigns didn't load");
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [admin, load]);

  const replace = (c: AdminCampaign) => setRows((rs) => (rs ? (rs.some((r) => r.id === c.id) ? rs.map((r) => (r.id === c.id ? c : r)) : [c, ...rs]) : [c]));

  const save = async (draft: CampaignDraft, id?: string) => {
    const r = await apiFetch<Envelope<{ campaign: AdminCampaign }>>(id ? `/api/admin/campaigns/${id}` : "/api/admin/campaigns", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(draft),
    });
    replace(r.data.campaign);
    setEditing(null);
  };

  if (isLoading || (user && admin === null)) {
    return (
      <Shell>
        <div className="h-[60vh] animate-pulse rounded-panel bg-surface" />
      </Shell>
    );
  }

  if (!user || !admin) {
    return (
      <Empty
        className="min-h-screen"
        icon={<ShieldStar size={36} />}
        title="Admins only"
        body="Campaigns are set up by Xtream's partnerships team."
        goLive={false}
        action={{ label: "Back home", href: "/" }}
      />
    );
  }

  const live = (rows ?? []).filter((r) => r.status === "live");
  const pool = live.reduce((n, r) => n + Math.max(0, r.budgetUsdMinor - r.spentUsdMinor), 0);

  return (
    <Shell>
      <AdminTabs current="campaigns" />
      <header className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className={EYEBROW}>Partnerships</p>
          <h1 className="mt-2 font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">Campaigns</h1>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
            Set up a brand&apos;s campaign, record what they prepaid, and put it live. Creators join it from their Sponsorships page and are paid per stream
            that runs the card.
          </p>
        </div>
        {editing === null && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="press flex h-11 shrink-0 items-center gap-2 self-start rounded-full bg-inverse px-5 text-[14px] font-semibold text-on-inverse md:self-auto"
          >
            <Plus size={16} weight="bold" />
            New campaign
          </button>
        )}
      </header>

      {rows && rows.length > 0 && (
        <p className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
          <span className="tabular-nums">{live.length} live</span>
          <span>
            <span className="font-money text-value">{formatUsd(pool)}</span> left to pay creators
          </span>
        </p>
      )}

      {error && <p className="mb-4 rounded-[12px] bg-chili/[0.12] px-4 py-3 text-[13px] text-chili-hi">{error}</p>}

      {editing === "new" && (
        <div className={cn(TILE, "mb-4 p-5 md:p-7")}>
          <p className="mb-6 font-wide text-[20px] font-bold tracking-[-0.03em]">New campaign</p>
          <CampaignForm campaign={null} onCancel={() => setEditing(null)} onSave={(d) => save(d)} />
        </div>
      )}

      {rows === null ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-52 animate-pulse rounded-panel bg-surface" />
          ))}
        </div>
      ) : rows.length === 0 && editing !== "new" ? (
        <div className={TILE}>
          <Empty icon={<Storefront size={30} />} title="No campaigns yet" body="Set up the first one from a brand's brief." goLive={false} action={{ label: "New campaign", onClick: () => setEditing("new") }} />
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((c) =>
            editing !== null && editing !== "new" && editing.id === c.id ? (
              <li key={c.id} className={cn(TILE, "p-5 md:p-7")}>
                <p className="mb-6 font-wide text-[20px] font-bold tracking-[-0.03em]">Edit {c.name}</p>
                <CampaignForm campaign={c} onCancel={() => setEditing(null)} onSave={(d) => save(d, c.id)} />
              </li>
            ) : (
              <CampaignRow key={c.id} campaign={c} onEdit={() => setEditing(c)} onChange={replace} onError={setError} />
            )
          )}
        </ul>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[980px]">{children}</div>
    </div>
  );
}
