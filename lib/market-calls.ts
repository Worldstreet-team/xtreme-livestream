"use client";

import { useSyncExternalStore } from "react";
import {
  CALL_CHECKPOINT_MS,
  CALL_CHECKPOINTS,
  type CallCheckpoint,
  type CallDirection,
  type CallLayer,
  type CallOutcomeView,
  type CallSummary,
  type CallView,
  type CallsPage,
} from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";
import { formatQuote, marketBase } from "@/lib/market";

/**
 * Call receipts on the client (Phase 4): whether they're switched on, the
 * words for a call and its checkpoints, and the requests. What a call
 * says — the price, the time, how it went — is always the API's record;
 * this file only reads it and puts it into words. (Not the voice and video
 * calls in lib/call-manager.ts: these are market calls.)
 */

export type { CallCheckpoint, CallDirection, CallLayer, CallOutcomeView, CallSummary, CallView, CallsPage };
export { CALL_CHECKPOINTS };

/* ---- Whether calls are on (GET /calls/enabled) ---- */

let enabled: boolean | null = null;
let asking = false;
const listeners = new Set<() => void>();

function ask() {
  if (enabled !== null || asking) return;
  asking = true;
  apiFetch<{ success: boolean; data?: { enabled?: boolean } }>("/api/calls/enabled")
    .then((r) => {
      enabled = r.data?.enabled === true;
    })
    // Unreadable: it stays off here, and the next screen that needs it asks again.
    .catch(() => {})
    .finally(() => {
      asking = false;
      listeners.forEach((l) => l());
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ask();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether call receipts are switched on — asked once a page load and
 * shared. Off until the answer's in, and off when it can't be had: with
 * the switch off, every surface of them hides itself.
 */
export function useCallsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled === true, () => false);
}

/* ---- Words ---- */

/** "SOL up": what was called. */
export const callWords = (c: { symbol: string; direction: CallDirection }) => `${marketBase(c.symbol)} ${c.direction}`;

/** Each checkpoint in words, for where there's room. */
export const CALL_CHECKPOINT_WORDS: Record<CallCheckpoint, string> = { h1: "1 hour", h24: "24 hours", d7: "7 days" };

/**
 * A price as a call keeps it: the strip's way ("$142.10"), except that a
 * coin worth fractions of a cent keeps its significant figures
 * ("$0.00001126") — on a record, "$0.0000" would say nothing at all.
 */
export function formatCallPrice(symbol: string, price: number) {
  if (price >= 0.01) return formatQuote(symbol, price);
  const quote = symbol.split("-")[1] ?? "";
  const figures = price.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 4 });
  return quote === "USD" || quote === "USDT" || quote === "USDC" ? `$${figures}` : `${figures} ${quote}`;
}

/** The move from the call's price to another, in per cent. */
export const moveSince = (entryPrice: number, price: number) => ((price - entryPrice) / entryPrice) * 100;

/** Did the price move the way it was called? Flat didn't. (The API's rule for "right".) */
export const wentTheCalledWay = (direction: CallDirection, changePct: number) => (direction === "up" ? changePct > 0 : changePct < 0);

/** "1.24%", "12.5%": a move's size — the arrow beside it says which way. */
export function formatMove(pct: number) {
  const size = Math.abs(pct);
  return `${size.toFixed(size >= 10 ? 1 : 2)}%`;
}

/** "20:14", in the reader's own time. */
export function formatCallTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "26 Sep", in the reader's own calendar. */
export function formatCallDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** "in 40 min", "in 3 h", "in 5 d" — how long until a checkpoint. */
export function formatIn(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(ms / 86_400_000)} d`;
}

/** Where a checkpoint stands for the reader. */
export type CheckpointState =
  | { state: "done"; price: number; changePct: number; calledWay: boolean }
  | { state: "unavailable" }
  /** Its time has come; the price is on its way (the sweep reads the closed minute). */
  | { state: "checking" }
  | { state: "pending"; inMs: number };

export function checkpointState(call: Pick<CallView, "direction" | "entry" | "outcomes">, k: CallCheckpoint, now: number): CheckpointState {
  const o = call.outcomes[k];
  if (o) {
    return o.unavailable
      ? { state: "unavailable" }
      : { state: "done", price: o.price, changePct: o.changePct, calledWay: wentTheCalledWay(call.direction, o.changePct) };
  }
  const due = Date.parse(call.entry.at) + CALL_CHECKPOINT_MS[k];
  return due > now ? { state: "pending", inMs: due - now } : { state: "checking" };
}

/* ---- Requests ---- */

/** Make a call on a live stream. The API records the price and time itself; the answer brings the card to put up. */
export async function postCall(streamId: string, body: { symbol: string; direction: CallDirection; note: string }) {
  const r = await apiFetch<{ success: boolean; data: { call: CallView; layer: CallLayer } }>(`/api/streams/${streamId}/calls`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return r.data;
}

/** A channel's calls, newest first; the first page brings the summary. */
export async function fetchCalls(username: string, cursor?: string | null, limit = 12): Promise<CallsPage> {
  const q = new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) });
  const r = await apiFetch<{ success: boolean; data: CallsPage }>(`/api/users/${encodeURIComponent(username)}/calls?${q}`);
  return r.data;
}

let markets: Promise<string[] | null> | null = null;

/** Every market a call can be made on (USD pairs Coinbase trades), asked once. Null when the list couldn't be had — ask again later. */
export function fetchCallMarkets(): Promise<string[] | null> {
  markets ??= apiFetch<{ success: boolean; data: { markets?: string[] } }>("/api/calls/markets")
    .then((r) => r.data.markets ?? [])
    .catch(() => {
      markets = null;
      return null;
    });
  return markets;
}
