import crypto from "node:crypto";
import type mongoose from "mongoose";
import {
  HEAT_STEPS_MINOR,
  HEAT_WINDOW_MS,
  type GoalBody,
  type GoalKind,
  type StreamGoal,
  type StreamHeat,
} from "@xtreme/contracts";
import { sendRoomData } from "./livekit.js";
import { GiftTransaction, Stream, type IStream } from "./models.js";
import { fireRules } from "./rules.js";

/**
 * Goals and the heat meter (Phase 2, goals and status).
 *
 * `goal` is written only here, each time with one atomic update that
 * touches nothing else — like the featured comment (featured.ts) — so a
 * gift landing while the host changes the goal can't double-count, and a
 * goal can't be rolled back by a stale write. Every change moves `rev` on
 * and reaches the room as `__evt: goal`; whoever joins later reads it with
 * the stream. Taking a goal down marks it ended rather than deleting it,
 * so the next goal's `rev` keeps climbing and no screen mistakes old for new.
 */

type StoredGoal = NonNullable<IStream["goal"]>;
type StreamId = mongoose.Types.ObjectId | string;

/** The goal as clients read it (who allied stays on the server). */
export function goalView(goal: StoredGoal | null | undefined): StreamGoal | null {
  if (!goal) return null;
  return {
    id: goal.id,
    kind: goal.kind,
    title: goal.title,
    target: goal.target,
    milestones: goal.milestones ?? [],
    progress: goal.progress ?? 0,
    startedAt: new Date(goal.startedAt).toISOString(),
    reachedAt: goal.reachedAt ? new Date(goal.reachedAt).toISOString() : null,
    endedAt: goal.endedAt ? new Date(goal.endedAt).toISOString() : null,
    rev: goal.rev ?? 0,
  };
}

export function heatView(heat: IStream["heat"] | null | undefined): StreamHeat | null {
  return heat ? { level: heat.level, at: new Date(heat.at).toISOString() } : null;
}

/** The room hears the goal as it now stands; `reached` marks the write that crossed the line. */
function announce(roomName: string | undefined, goal: StoredGoal | null | undefined, reached = false) {
  if (!roomName) return;
  void sendRoomData(roomName, { __evt: "goal", goal: goalView(goal), ...(reached ? { reached: true } : {}) });
}

/**
 * Put a goal up on a live stream: a new one starts at zero, whatever was
 * there before. Resolves to the goal, or null when the stream isn't live.
 */
export async function setGoal(streamId: StreamId, body: GoalBody, now = Date.now()) {
  const fields = {
    id: crypto.randomUUID(),
    kind: body.kind,
    title: body.title,
    target: body.target,
    milestones: body.milestones,
    progress: 0,
    startedAt: new Date(now),
    reachedAt: null,
    endedAt: null,
    alliedBy: [],
  };
  // One pipeline update, so `rev` climbs from whatever is stored — and
  // $literal, so a title like "$50 for a new mic" stays words, not a path.
  const updated = await Stream.findOneAndUpdate(
    { _id: streamId, isLive: true },
    [
      {
        $set: {
          goal: { $mergeObjects: [{ $literal: fields }, { rev: { $add: [{ $ifNull: ["$goal.rev", 0] }, 1] } }] },
        },
      },
    ],
    // Mongoose 9 takes a pipeline only when asked to.
    { new: true, select: "goal livekitRoomName", updatePipeline: true },
  ).lean();
  if (!updated?.goal) return null;
  announce(updated.livekitRoomName, updated.goal);
  return goalView(updated.goal);
}

/** Take the goal down (it stays stored, ended). Resolves to it, or null when there's none up. */
export async function endGoal(streamId: StreamId, now = Date.now()) {
  const updated = await Stream.findOneAndUpdate(
    { _id: streamId, isLive: true, "goal.id": { $exists: true }, "goal.endedAt": null },
    { $set: { "goal.endedAt": new Date(now) }, $inc: { "goal.rev": 1 } },
    { new: true, select: "goal livekitRoomName" },
  ).lean();
  if (!updated?.goal) return null;
  announce(updated.livekitRoomName, updated.goal);
  return goalView(updated.goal);
}

/**
 * Move the goal on by `by` — a gift's cents, a like, an ally — if a goal
 * of that kind is up. An ally counts once per goal (`by` user id), however
 * often they toggle. The write that crosses the target stamps `reachedAt`
 * and tells the room it was reached, once.
 */
export async function bumpGoal(
  streamId: StreamId,
  kind: GoalKind,
  by: number,
  { userId, now = Date.now() }: { userId?: mongoose.Types.ObjectId; now?: number } = {},
) {
  if (by <= 0) return null;
  const once = kind === "allies" && userId;
  const updated = await Stream.findOneAndUpdate(
    {
      _id: streamId,
      isLive: true,
      "goal.kind": kind,
      "goal.endedAt": null,
      ...(once ? { "goal.alliedBy": { $ne: userId } } : {}),
    },
    {
      $inc: { "goal.progress": by, "goal.rev": 1 },
      ...(once ? { $push: { "goal.alliedBy": userId } } : {}),
    },
    { new: true, select: "goal livekitRoomName" },
  ).lean();
  const goal = updated?.goal;
  if (!goal) return null;

  if (!goal.reachedAt && goal.progress >= goal.target) {
    // Only one write gets to say it was reached: the one that finds it unreached.
    const crossed = await Stream.findOneAndUpdate(
      { _id: streamId, "goal.id": goal.id, "goal.reachedAt": null },
      { $set: { "goal.reachedAt": new Date(now) }, $inc: { "goal.rev": 1 } },
      { new: true, select: "goal livekitRoomName streamerId" },
    ).lean();
    if (crossed?.goal) {
      announce(crossed.livekitRoomName, crossed.goal, true);
      // The host's show rules for a goal reached (rules.ts).
      void fireRules(crossed, { kind: "goal_reached", goal: crossed.goal.title });
      return goalView(crossed.goal);
    }
  }
  announce(updated.livekitRoomName, goal);
  return goalView(goal);
}

/** The level a minute's gifts reach: 0 under $5, up to 5 at $250. */
export function heatLevel(sumMinor: number) {
  return HEAT_STEPS_MINOR.filter((step) => sumMinor >= step).length;
}

/**
 * After a gift: what the last minute of gifts adds up to, as a level. The
 * meter shows from $5 a minute; screens cool it a level every 20 s after
 * `at` (HEAT_COOL_MS), so there's nothing to sweep.
 */
export async function bumpHeat(stream: Pick<IStream, "_id" | "livekitRoomName">, now = Date.now()) {
  const [window] = await GiftTransaction.aggregate<{ _id: null; sum: number }>([
    { $match: { streamId: stream._id, createdAt: { $gte: new Date(now - HEAT_WINDOW_MS) } } },
    { $group: { _id: null, sum: { $sum: "$grossUsdMinor" } } },
  ]);
  const level = heatLevel(window?.sum ?? 0);
  if (level === 0) return null;
  const heat = { level, at: new Date(now) };
  await Stream.updateOne({ _id: stream._id }, { $set: { heat } });
  void sendRoomData(stream.livekitRoomName, { __evt: "heat", heat: heatView(heat) });
  return heatView(heat);
}
