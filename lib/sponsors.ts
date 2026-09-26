"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  inRestrictedSponsorRegion,
  type CampaignView,
  type SponsorCategory,
  type SponsoredQuestView,
  type SponsorRunView,
  type SponsorView,
} from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";

/**
 * Sponsorships on the client (Phase 2, sponsor slots): a creator's own
 * sponsors and the Xtream campaigns they can join, the viewer's sponsored
 * quests, and where the viewer is — crypto, betting and alcohol sponsors
 * stay off screens in Nigeria unless the platform cleared the campaign.
 *
 * What a card says is never decided here: the studio names a sponsor, and
 * the API fills in the card from its own records (sponsors.ts).
 */

export type { CampaignView, SponsorCategory, SponsoredQuestView, SponsorRunView, SponsorView };
export { MAX_SPONSORS, SPONSOR_CATEGORIES } from "@xtreme/contracts";

export const SPONSOR_CATEGORY_LABELS: Record<SponsorCategory, { label: string; hint: string }> = {
  everyday: { label: "Products & services", hint: "Food, fashion, apps, games, events" },
  finance: { label: "Banking & payments", hint: "Banks, cards, transfers — not crypto tokens" },
  crypto: { label: "Crypto", hint: "Tokens and exchanges. Kept off screens in Nigeria." },
  betting: { label: "Betting", hint: "Kept off screens in Nigeria." },
  alcohol: { label: "Alcohol", hint: "Kept off screens in Nigeria." },
};

/** Why a campaign run wasn't paid, as the creator reads it. */
export const UNPAID_REASONS: Record<Exclude<SponsorRunView["unpaidReason"], "">, string> = {
  short: "Not up long enough",
  viewers: "Audience under the minimum",
  cap: "You'd had your paid streams",
  budget: "The campaign's budget ran out",
  left: "You'd left the campaign",
  ended: "The campaign ended first",
};

/* ------------------------------------------------------------------ */
/* Where the viewer is                                                 */
/* ------------------------------------------------------------------ */

const REGION_KEY = "xtream:sponsor-region";
let region: boolean | null = null;
let regionLoad: Promise<void> | null = null;
const regionListeners = new Set<() => void>();

export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

function loadRegion() {
  if (regionLoad) return;
  regionLoad = (async () => {
    let restricted: boolean | null = null;
    try {
      const saved = sessionStorage.getItem(REGION_KEY);
      if (saved === "1" || saved === "0") restricted = saved === "1";
    } catch {
      // Storage can be off; ask again.
    }
    if (restricted === null) {
      let country: string | null = null;
      try {
        country = (await apiFetch<{ success: boolean; data: { country: string | null } }>("/api/geo")).data.country;
      } catch {
        // No answer: the clock decides.
      }
      restricted = inRestrictedSponsorRegion(country, viewerTimeZone());
      try {
        sessionStorage.setItem(REGION_KEY, restricted ? "1" : "0");
      } catch {
        // Fine — it's asked once per page load then.
      }
    }
    region = restricted;
    regionListeners.forEach((l) => l());
  })();
}

/**
 * Whether restricted sponsors stay off this viewer's screen — null until
 * it's known, which draws as restricted, so a card never flashes up and
 * disappears.
 */
export function useRestrictedRegion(): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      regionListeners.add(listener);
      loadRegion();
      return () => regionListeners.delete(listener);
    },
    () => region,
    () => null,
  );
}

/* ------------------------------------------------------------------ */
/* A creator's sponsorships                                            */
/* ------------------------------------------------------------------ */

export interface Sponsorships {
  sponsors: SponsorView[];
  campaigns: CampaignView[];
  runs: SponsorRunView[];
}

export interface SponsorDraft {
  name: string;
  line: string;
  url: string;
  code: string;
  category: SponsorCategory;
  /** A data URI for a new logo, "" to remove it, absent to keep it. */
  logo?: string;
}

type Envelope<T> = { success: boolean; data: T };

/** Everything sponsored on your channel, and the ways to change it. */
export function useSponsorships(enabled = true) {
  const [data, setData] = useState<Sponsorships | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await apiFetch<Envelope<Sponsorships>>("/api/users/me/sponsorships");
      setData(r.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [enabled, reload]);

  const saveSponsor = useCallback(
    async (draft: SponsorDraft, id?: string) => {
      const r = await apiFetch<Envelope<{ sponsor: SponsorView }>>(id ? `/api/users/me/sponsors/${id}` : "/api/users/me/sponsors", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(draft),
      });
      setData((d) =>
        d
          ? { ...d, sponsors: id ? d.sponsors.map((s) => (s.id === id ? r.data.sponsor : s)) : [...d.sponsors, r.data.sponsor] }
          : d,
      );
      return r.data.sponsor;
    },
    [],
  );

  const removeSponsor = useCallback(async (id: string) => {
    await apiFetch(`/api/users/me/sponsors/${id}`, { method: "DELETE" });
    setData((d) => (d ? { ...d, sponsors: d.sponsors.filter((s) => s.id !== id) } : d));
  }, []);

  const setJoined = useCallback(async (campaignId: string, join: boolean) => {
    const r = await apiFetch<Envelope<{ campaign: CampaignView | null }>>(`/api/campaigns/${campaignId}/${join ? "join" : "leave"}`, { method: "POST" });
    const next = r.data.campaign;
    if (next) setData((d) => (d ? { ...d, campaigns: d.campaigns.map((c) => (c.id === campaignId ? next : c)) } : d));
    return next;
  }, []);

  return { data, failed, reload, saveSponsor, removeSponsor, setJoined };
}

/* ------------------------------------------------------------------ */
/* Sponsored quests                                                    */
/* ------------------------------------------------------------------ */

function questPath(campaignId: string, action = "") {
  return `/api/campaigns/${campaignId}/quest${action}?tz=${encodeURIComponent(viewerTimeZone())}`;
}

/**
 * The quest on the card that's up now: the prize, and — signed in — your
 * minutes toward it, re-read every minute while you watch.
 */
export function useSponsoredQuest(campaignId: string | null, signedIn: boolean) {
  const [state, setState] = useState<{ id: string; quest: SponsoredQuestView | null } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let alive = true;
    const read = () =>
      apiFetch<Envelope<{ quest: SponsoredQuestView | null; available: boolean }>>(questPath(campaignId))
        .then((r) => alive && setState({ id: campaignId, quest: r.data.available ? r.data.quest : null }))
        .catch(() => alive && setState({ id: campaignId, quest: null }));
    void read();
    const t = setInterval(read, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [campaignId, signedIn]);

  const quest = state && state.id === campaignId ? state.quest : null;

  const claim = useCallback(async () => {
    if (!campaignId) return;
    setClaiming(true);
    setError(null);
    try {
      const r = await apiFetch<Envelope<{ voucher: { code: string; claimedAt: string } }>>(questPath(campaignId, "/claim"), { method: "POST" });
      setState((s) => (s?.quest ? { ...s, quest: { ...s.quest, voucher: r.data.voucher } } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that — try again.");
    } finally {
      setClaiming(false);
    }
  }, [campaignId]);

  return { quest, claim, claiming, error };
}

/** Your sponsored quests and the vouchers you've won (the wallet's Vouchers tab). */
export function useVouchers(enabled: boolean) {
  const [quests, setQuests] = useState<SponsoredQuestView[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiFetch<Envelope<{ quests: SponsoredQuestView[] }>>(`/api/user/me/vouchers?tz=${encodeURIComponent(viewerTimeZone())}`)
      .then((r) => alive && setQuests(r.data.quests))
      .catch(() => alive && setQuests([]));
    return () => {
      alive = false;
    };
  }, [enabled]);

  /** Claim a finished quest's voucher; it lands in the list. */
  const claim = useCallback(async (campaignId: string) => {
    const r = await apiFetch<Envelope<{ voucher: { code: string; claimedAt: string } }>>(questPath(campaignId, "/claim"), { method: "POST" });
    setQuests((qs) => (qs ? qs.map((q) => (q.campaignId === campaignId ? { ...q, voucher: r.data.voucher } : q)) : qs));
  }, []);

  return { quests, claim };
}

/** "brand.com/deals" — a link as people read it. */
export function linkLabel(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

/** "12 min", "1 h 05 min" — how long a card was up. */
export function onScreenLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
