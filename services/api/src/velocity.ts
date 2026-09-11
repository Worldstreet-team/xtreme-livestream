import { Stream, ViewerSample } from "./models.js";

/**
 * "Trending" used to sort by viewers with a startedAt tiebreak — which, since
 * viewer counts are near-unique, was the popularity sort under another name.
 * Velocity is growth: the current count against the count ten minutes ago,
 * normalised by the earlier level so a stream going 20→300 scores far above
 * one that drifted 30,000→30,400. Sampled once a minute for every live
 * stream; scored from the sample nearest the window edge.
 */

export const VELOCITY_WINDOW_MS = 10 * 60_000;
export const VELOCITY_SWEEP_INTERVAL_MS = 60_000;

/** Below this many earlier viewers the ratio is noise, so the floor takes over. */
const BASELINE_FLOOR = 10;
/** How far either side of the window edge a sample still counts as "then". */
const WINDOW_SLACK_MS = 90_000;

export function scoreVelocity(now: number, then: number) {
  const base = Math.max(then, BASELINE_FLOOR);
  return Math.round(((now - then) / base) * 1000) / 1000;
}

export async function sampleAndScoreVelocity(at = new Date()) {
  const live = await Stream.find({ isLive: true })
    .select("_id viewers")
    .lean();
  if (live.length === 0) return 0;

  await ViewerSample.insertMany(
    live.map((s) => ({ streamId: s._id, viewers: s.viewers, at })),
    { ordered: false },
  );

  const edge = at.getTime() - VELOCITY_WINDOW_MS;
  const earlier = await ViewerSample.aggregate<{ _id: unknown; viewers: number }>([
    {
      $match: {
        streamId: { $in: live.map((s) => s._id) },
        at: {
          $gte: new Date(edge - WINDOW_SLACK_MS),
          $lte: new Date(edge + WINDOW_SLACK_MS),
        },
      },
    },
    // Oldest first, so $first is the reading closest to the window edge.
    { $sort: { at: 1 } },
    { $group: { _id: "$streamId", viewers: { $first: "$viewers" } } },
  ]);
  const thenByStream = new Map(earlier.map((e) => [String(e._id), e.viewers]));

  const writes = live.flatMap((s) => {
    const then = thenByStream.get(String(s._id));
    // Too young to have a reading ten minutes back: leave velocity alone
    // rather than scoring a fresh stream as flat.
    if (then === undefined) return [];
    return [
      {
        updateOne: {
          filter: { _id: s._id },
          update: { $set: { velocity: scoreVelocity(s.viewers, then) } },
        },
      },
    ];
  });
  if (writes.length > 0) await Stream.bulkWrite(writes, { ordered: false });
  return writes.length;
}

export function startVelocitySweep() {
  const run = () =>
    void sampleAndScoreVelocity().catch((error) => {
      console.error("Velocity sweep failed:", error);
    });

  run();
  const timer = setInterval(run, VELOCITY_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
