import { closeRoom } from "./livekit.js";
import { PreparedStream } from "./models.js";

/**
 * Going live in two steps (owner, 2026-09-29: "Starting the live takes
 * time, even the ending"). The studio's 3·2·1 is the wait: the tap
 * prepares the stream (POST /streams with `prepare: true`) and joins its
 * room while the numbers run, and the end of the count commits it
 * (POST /streams/:id/go) — the one step left at "1" is a single write.
 *
 * A prepared stream is private by construction (its own collection, see
 * IPreparedStream): nobody is told, nothing is listed, the live ring stays
 * off. One that's never committed is thrown away — by the studio on cancel
 * (DELETE /streams/:id/prepare), or here after PREPARED_STREAM_TTL_MS.
 */

/** How long a prepared stream waits for its commit. The count is 3 s; two minutes covers a slow phone and then some. */
export const PREPARED_STREAM_TTL_MS = 2 * 60_000;

/** How often the sweep looks. */
const SWEEP_EVERY_MS = 30_000;

/** Throw away every prepared stream past its expiry, and close its room. Returns how many went. */
export async function sweepPreparedStreams(now = Date.now()): Promise<number> {
  const stale = await PreparedStream.find({ expiresAt: { $lte: new Date(now) } })
    .select("_id livekitRoomName")
    .limit(500)
    .lean();
  let removed = 0;
  for (const row of stale) {
    const { deletedCount } = await PreparedStream.deleteOne({ _id: row._id, expiresAt: { $lte: new Date(now) } });
    if (!deletedCount) continue;
    removed += 1;
    // The studio that made it is long gone or gave up: nobody should be left in its room.
    void closeRoom(row.livekitRoomName).catch(() => {});
  }
  return removed;
}

export function startPreparedStreamSweep() {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void sweepPreparedStreams()
      .catch((e) => console.error("prepared stream sweep failed:", e))
      .finally(() => {
        running = false;
      });
  }, SWEEP_EVERY_MS);
}
