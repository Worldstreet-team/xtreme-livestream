import { apiUrl } from "@/lib/api-client";
import type { Category, Stream } from "@/lib/categories";

/**
 * Client-side shapes for the rows engine (`GET /api/home`) and the other
 * discovery endpoints, plus the mapping onto the card type the grid renders.
 */

export type RowKind = "streams" | "upcoming" | "channels";

export interface RowStreamer {
  _id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  verified?: boolean;
}

export interface RowItem {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  thumbnailUrl: string | null;
  /** A looping clip to preview when the room has no live video (seeded streams, reconnects). */
  previewUrl?: string | null;
  isLive: boolean;
  status: "upcoming" | "live" | "ended";
  viewers: number;
  peakViewers: number;
  velocity: number;
  startedAt: string | null;
  endedAt?: string | null;
  scheduledStartAt: string | null;
  duration: string;
  streamerId: RowStreamer;
  reminded?: boolean;
}

export interface HomeRow {
  id: string;
  title: string;
  reason?: string;
  kind: RowKind;
  explore?: boolean;
  items: RowItem[];
}

export type LeadReason = "followed" | "trending" | "rising" | "popular";

export interface HomeLead {
  reason: LeadReason;
  item: RowItem;
}

export interface HomePage {
  rows: HomeRow[];
  leads: HomeLead[];
}

export interface CategorySummary {
  category: Category;
  live: number;
  viewers: number;
  cover: string | null;
}

/** The label a lead's reason renders as. */
export const LEAD_LABEL: Record<LeadReason, string> = {
  followed: "From a channel you follow",
  trending: "Trending",
  rising: "Rising",
  popular: "Popular now",
};

export function toCard(item: RowItem): Stream {
  return {
    id: item._id,
    title: item.title,
    category: item.category,
    tags: item.tags,
    thumbnailUrl: apiUrl(item.thumbnailUrl),
    isLive: item.isLive,
    viewers: item.viewers,
    peakViewers: item.peakViewers,
    startedAt: item.startedAt ?? "",
    duration: item.duration,
    streamer: {
      id: item.streamerId._id,
      username: item.streamerId.username,
      displayName: item.streamerId.displayName,
      avatar: item.streamerId.avatar,
      isLive: item.streamerId.isLive,
      verified: item.streamerId.verified ?? false,
    },
  };
}

/** "in 45 min", "in 3 h", "tomorrow 19:00", "Sat 15:00". */
export function formatStartsIn(iso: string, now = Date.now()) {
  const t = new Date(iso).getTime();
  const diff = t - now;
  if (diff <= 0) return "starting now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 12) return `in ${hours} h`;
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const dayDiff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** Live for 1:23:45 — ticks from startedAt. */
export function formatUptime(startedAt: string | null, now = Date.now()) {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
