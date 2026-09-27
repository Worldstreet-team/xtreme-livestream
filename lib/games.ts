/**
 * Games and points, as the client sees them. The server holds stakes,
 * locks the window, draws, reveals and pays out; this is rendering and
 * arithmetic.
 */

import { marketQuestionText, type MarketOracleView } from "@xtreme/contracts";

export type { MarketOracleView };

export type GameStatus = "open" | "locked" | "settled" | "cancelled";
export type GameType = "prediction" | "raffle" | "quiz";

export interface GameOutcome {
  id: string;
  label: string;
  points: number;
  entries: number;
}

export interface GameWinner {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface GameView {
  id: string;
  streamId: string;
  type: GameType;
  status: GameStatus;
  question: string;
  outcomes: GameOutcome[];
  closesAt: string;
  poolPoints: number;
  entries: number;
  winningOutcome: string | null;
  ticketPoints: number;
  winnersCount: number;
  prizePoints: number;
  correctOutcome: string | null;
  winners: GameWinner[];
  settledAt: string | null;
  /** A vote, not a bet: picks carry no stake and nobody wins points. */
  voteOnly?: boolean;
  /** A market question ("SOL above $150.00 at 20:30?"): settles itself from Coinbase, and is always a vote. */
  oracle?: MarketOracleView | null;
  mine?: { outcome: string; stakePoints: number; wonPoints: number } | null;
}

/**
 * A game's question as this screen says it: a market question in this
 * device's own time (written from its oracle, as the API wrote the stored
 * one on the host's clock), anything else as the host typed it.
 */
export function questionOf(g: Pick<GameView, "question" | "oracle">, now = Date.now()) {
  return g.oracle ? marketQuestionText(g.oracle, { now }) : g.question;
}

/** An unsettled game gives every stake and ticket back after this long. */
export const STALE_REFUND_HOURS = 24;

/** Whether entering costs points — the case the refund promise is for. */
export function holdsStakes(g: GameView) {
  return (g.type === "prediction" && !g.voteOnly) || (g.type === "raffle" && g.ticketPoints > 0);
}

/** Share of the picks on an outcome — how a vote (or a quiz) is split. */
export function pickShare(g: GameView, id: string) {
  const o = g.outcomes.find((x) => x.id === id);
  if (!o || g.entries === 0) return 1 / g.outcomes.length;
  return o.entries / g.entries;
}

export interface LiveGameItem {
  game: GameView;
  stream: {
    id: string;
    title: string;
    category: string;
    viewers: number;
    thumbnailUrl: string | null;
    streamer: { username: string; displayName: string; avatar: string };
  };
}

export const STAKES = [10, 50, 100, 500];

export const GAME_LABEL: Record<GameType, string> = {
  prediction: "Prediction",
  raffle: "Raffle",
  quiz: "Quiz",
};

export function secondsToClose(g: GameView, now: number) {
  return Math.max(0, Math.ceil((new Date(g.closesAt).getTime() - now) / 1000));
}

/** Share of the pool on an outcome, as a fraction; even split before any stakes. */
export function outcomeShare(g: GameView, id: string) {
  const o = g.outcomes.find((x) => x.id === id);
  if (!o || g.poolPoints === 0) return 1 / g.outcomes.length;
  return o.points / g.poolPoints;
}

/** What 1 point staked on this outcome would return if it won, right now. */
export function payoutMultiplier(g: GameView, id: string) {
  const o = g.outcomes.find((x) => x.id === id);
  if (!o || o.points === 0) return null;
  return g.poolPoints / o.points;
}

export function isGameLive(g: GameView | null | undefined) {
  return !!g && (g.status === "open" || g.status === "locked");
}

export function formatPoints(n: number) {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/** Tell every points chip on the page the balance moved. */
export function announcePoints(balance?: number) {
  window.dispatchEvent(new CustomEvent("xtreme:points", { detail: balance }));
}
