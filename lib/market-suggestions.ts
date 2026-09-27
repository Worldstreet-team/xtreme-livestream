"use client";

import { useCallback, useEffect, useReducer } from "react";
import {
  CHART_INTERVALS,
  MARKET_SUGGESTION_KINDS,
  MAX_MARKET_SUGGESTIONS,
  type ChartInterval,
  type MarketQuestionPreset,
  type MarketSuggestion,
  type MarketSuggestionKind,
} from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";
import { serverNow } from "@/lib/server-clock";

/**
 * The market as director, on the client (Phase 4): the host's studio and
 * their producers' consoles hear `__evt: "suggestion"` when a market the
 * show cares about moves, and GET /streams/:id/suggestions gives a
 * reloaded screen the last few back. This reads them off the wire and
 * keeps the tray's list; the tray is components/app/market-suggestions.tsx.
 */

export type { MarketQuestionPreset, MarketSuggestion };

/** How long one stays in the tray: half an hour, as the API keeps them. */
export const SUGGESTION_TTL_MS = 30 * 60_000;

const SYMBOL = /^[A-Z0-9]{2,10}-[A-Z]{3,4}$/;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function readPreset(raw: unknown): MarketQuestionPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = str(r.symbol, 15).toUpperCase();
  const above = num(r.above);
  const minutes = num(r.minutes);
  if (!SYMBOL.test(symbol) || !symbol.endsWith("-USD") || above === null || above <= 0) return null;
  return { symbol, above, minutes: minutes !== null && minutes >= 5 && minutes <= 1440 ? Math.round(minutes) : 15 };
}

/** A suggestion off the wire (`__evt: "suggestion"`, GET /streams/:id/suggestions), if it's whole enough to act on. */
export function readSuggestion(raw: unknown): MarketSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const symbol = str(r.symbol, 15).toUpperCase();
  const kind = r.kind as MarketSuggestionKind;
  const price = num(r.price);
  const text = str(r.text, 120);
  const at = typeof r.at === "string" && Number.isFinite(Date.parse(r.at)) ? r.at : null;
  if (!id || !SYMBOL.test(symbol) || !MARKET_SUGGESTION_KINDS.includes(kind) || price === null || price <= 0 || !text || !at) return null;
  const actions = (r.actions && typeof r.actions === "object" ? r.actions : {}) as Record<string, unknown>;
  const chart = (actions.chart && typeof actions.chart === "object" ? actions.chart : {}) as Record<string, unknown>;
  const chartSymbol = str(chart.symbol, 15).toUpperCase();
  const interval = CHART_INTERVALS.includes(chart.interval as ChartInterval) ? (chart.interval as ChartInterval) : "5m";
  return {
    id,
    kind,
    symbol,
    text,
    price,
    changePct: num(r.changePct) ?? 0,
    windowMin: Math.max(0, Math.round(num(r.windowMin) ?? 0)),
    level: num(r.level),
    at,
    actions: {
      chart: { symbol: SYMBOL.test(chartSymbol) ? chartSymbol : symbol, interval },
      banner: str(actions.banner, 100),
      question: readPreset(actions.question),
    },
  };
}

export interface SuggestionsState {
  /** Newest first, the tray's few. */
  items: MarketSuggestion[];
  /** Ids the host waved away, so a late copy doesn't bring one back. */
  dismissed: string[];
}

export type SuggestionsAction =
  | { type: "add"; suggestion: MarketSuggestion }
  | { type: "load"; suggestions: MarketSuggestion[] }
  | { type: "dismiss"; id: string }
  | { type: "prune"; now: number }
  | { type: "reset"; dismissed: string[] };

const newestFirst = (list: MarketSuggestion[]) =>
  [...list].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_MARKET_SUGGESTIONS);

/** The tray's list: newest first, each once, none the host dismissed, none past its half hour. */
export function suggestionsReducer(state: SuggestionsState, action: SuggestionsAction): SuggestionsState {
  switch (action.type) {
    case "add": {
      const s = action.suggestion;
      if (state.dismissed.includes(s.id) || state.items.some((x) => x.id === s.id)) return state;
      return { ...state, items: newestFirst([s, ...state.items]) };
    }
    case "load": {
      const fresh = action.suggestions.filter((s) => !state.dismissed.includes(s.id) && !state.items.some((x) => x.id === s.id));
      return fresh.length === 0 ? state : { ...state, items: newestFirst([...state.items, ...fresh]) };
    }
    case "dismiss":
      return { items: state.items.filter((x) => x.id !== action.id), dismissed: [...state.dismissed.filter((x) => x !== action.id), action.id].slice(-50) };
    case "prune": {
      const items = state.items.filter((s) => action.now - Date.parse(s.at) < SUGGESTION_TTL_MS);
      return items.length === state.items.length ? state : { ...state, items };
    }
    case "reset":
      return { items: [], dismissed: action.dismissed };
  }
}

const dismissedKey = (streamId: string) => `xt:market-suggestions:dismissed:${streamId}`;

function readDismissed(streamId: string | null): string[] {
  if (!streamId) return [];
  try {
    const raw = JSON.parse(sessionStorage.getItem(dismissedKey(streamId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

function rememberDismissed(streamId: string | null, id: string) {
  if (!streamId) return;
  try {
    const ids = [...readDismissed(streamId).filter((x) => x !== id), id];
    sessionStorage.setItem(dismissedKey(streamId), JSON.stringify(ids.slice(-50)));
  } catch {
    // A private window: dismissals last as long as the page.
  }
}

/**
 * A stream's market suggestions for the tray: the last few from the API
 * when the stream is known (a reloaded studio or console sees them again),
 * then whatever the room brings — hand `push` the event's `suggestion`.
 * What's dismissed stays dismissed for the session.
 */
export function useMarketSuggestions(streamId: string | null) {
  const [state, dispatch] = useReducer(suggestionsReducer, { items: [], dismissed: [] });

  useEffect(() => {
    dispatch({ type: "reset", dismissed: readDismissed(streamId) });
    if (!streamId) return;
    let alive = true;
    apiFetch<{ success: boolean; data: { suggestions?: unknown[] } }>(`/api/streams/${streamId}/suggestions`)
      .then((r) => {
        if (!alive) return;
        const suggestions = (r.data.suggestions ?? []).map(readSuggestion).filter((s): s is MarketSuggestion => s !== null);
        dispatch({ type: "load", suggestions });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [streamId]);

  useEffect(() => {
    const t = setInterval(() => dispatch({ type: "prune", now: serverNow() }), 60_000);
    return () => clearInterval(t);
  }, []);

  const push = useCallback((raw: unknown) => {
    const suggestion = readSuggestion(raw);
    if (suggestion) dispatch({ type: "add", suggestion });
  }, []);
  const dismiss = useCallback(
    (id: string) => {
      dispatch({ type: "dismiss", id });
      rememberDismissed(streamId, id);
    },
    [streamId]
  );

  return { suggestions: state.items, push, dismiss };
}
