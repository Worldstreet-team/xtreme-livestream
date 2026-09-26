import {
  GOAL_KINDS,
  GOAL_TARGET_LIMITS,
  HEAT_COOL_MS,
  MAX_GOAL_MILESTONES,
  type GoalBody,
  type GoalKind,
  type GoalMilestone,
  type StreamGoal,
  type StreamHeat,
} from "@xtreme/contracts";
import { formatUsd } from "@/components/xtream/money";
import { formatNumber } from "@/lib/categories";

/**
 * Goals and the heat meter (Phase 2, goals and status) on the web: reading
 * them off the wire, choosing the newer of two, and saying them in words.
 * The API owns progress (services/api/src/goals.ts).
 */

export type { GoalBody, GoalKind, GoalMilestone, StreamGoal, StreamHeat };
export { GOAL_KINDS, GOAL_TARGET_LIMITS, MAX_GOAL_MILESTONES };

export const GOAL_KIND_LABELS: Record<GoalKind, { label: string; hint: string }> = {
  gifts: { label: "Gifts", hint: "Every gift's dollars count" },
  likes: { label: "Likes", hint: "One per person who likes the stream" },
  allies: { label: "New allies", hint: "Each person who allies while you're live" },
};

/** The five steps of the meter, from $5 a minute to $250. */
export const HEAT_NAMES = ["", "Warm", "Hot", "On fire", "Blazing", "Inferno"] as const;

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A goal from the API or the room, or null if it isn't one. */
export function readGoal(raw: unknown): StreamGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (!isString(g.id) || !GOAL_KINDS.includes(g.kind as GoalKind) || !isString(g.title)) return null;
  if (!isNumber(g.target) || !isNumber(g.progress) || !isNumber(g.rev)) return null;
  const milestones = Array.isArray(g.milestones)
    ? g.milestones
        .filter((m): m is GoalMilestone => Boolean(m) && isNumber((m as GoalMilestone).at) && isString((m as GoalMilestone).label))
        .slice(0, MAX_GOAL_MILESTONES)
    : [];
  return {
    id: g.id,
    kind: g.kind as GoalKind,
    title: g.title,
    target: g.target,
    milestones,
    progress: g.progress,
    startedAt: isString(g.startedAt) ? g.startedAt : new Date(0).toISOString(),
    reachedAt: isString(g.reachedAt) ? g.reachedAt : null,
    endedAt: isString(g.endedAt) ? g.endedAt : null,
    rev: g.rev,
  };
}

export function readHeat(raw: unknown): StreamHeat | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  return isNumber(h.level) && isString(h.at) ? { level: Math.max(0, Math.min(5, Math.round(h.level))), at: h.at } : null;
}

/**
 * The goal a screen should hold: the one with the higher `rev` — which only
 * climbs, across goals too — so an event arriving late never rolls it back.
 */
export function newerGoal(current: StreamGoal | null | undefined, next: StreamGoal | null): StreamGoal | null {
  if (!next) return current ?? null;
  if (!current || next.rev >= current.rev) return next;
  return current;
}

/** The later reading of the meter wins. */
export function newerHeat(current: StreamHeat | null | undefined, next: StreamHeat | null): StreamHeat | null {
  if (!next) return current ?? null;
  if (!current || Date.parse(next.at) >= Date.parse(current.at)) return next;
  return current;
}

/** The goal is up and worth drawing: set, and not taken down. */
export function goalShowing(goal: StreamGoal | null | undefined): goal is StreamGoal {
  return Boolean(goal && !goal.endedAt);
}

/** An amount toward a goal, as it reads: "$120", "$1.2K", "1.2K". */
export function goalAmount(kind: GoalKind, n: number) {
  return kind === "gifts" ? formatUsd(n, true) : formatNumber(n);
}

/** What the goal counts, for a line under it: "likes", "new allies". */
export function goalUnit(kind: GoalKind, n: number) {
  if (kind === "likes") return n === 1 ? "like" : "likes";
  if (kind === "allies") return n === 1 ? "new ally" : "new allies";
  return "";
}

/** The next milestone not yet passed, if any. */
export function nextMilestone(goal: Pick<StreamGoal, "milestones" | "progress">) {
  return goal.milestones.find((m) => m.at > goal.progress) ?? null;
}

/** The meter's level now: its level at the last gift, a step cooler every 20 s since. */
export function heatNow(heat: StreamHeat | null | undefined, now: number) {
  if (!heat) return 0;
  const cooled = Math.floor(Math.max(0, now - Date.parse(heat.at)) / HEAT_COOL_MS);
  return Math.max(0, heat.level - cooled);
}
