/**
 * Games and points, as the client sees them. The server holds stakes,
 * locks the window, draws, reveals and pays out; this is rendering and
 * arithmetic.
 */

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
  mine?: { outcome: string; stakePoints: number; wonPoints: number } | null;
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
