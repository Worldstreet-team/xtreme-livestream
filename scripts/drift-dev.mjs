// Local dev only: nudge each live stream's viewer count every 30s along a
// per-stream trend, so the velocity sweep has real movement to score and the
// Trending row doesn't collapse to nothing ten minutes after seeding.
//
// Mean-reverting on purpose. A naive "climbers gain 7% a tick" compounds to
// millions of viewers inside a couple of hours and makes every number on
// the page absurd. Each stream remembers the count it was seeded with and
// wanders within a band around it: climbers drift up toward 1.6x, faders
// toward 0.6x, flat ones jitter — and anything past its band is pulled back.
import { MongoClient } from "mongodb";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB = process.env.MONGODB_DB_NAME || "xtreme-livestream";
const EVERY_MS = 30_000;

const client = new MongoClient(URI);
await client.connect();
const streams = client.db(DB).collection("streams");

// Baseline per stream, captured on the first tick this process sees it.
const baseline = new Map();

async function tick() {
  const live = await streams
    .find({ isLive: true })
    .sort({ createdAt: 1 })
    .project({ viewers: 1 })
    .toArray();

  const ops = live.map((s, i) => {
    const id = String(s._id);
    if (!baseline.has(id)) baseline.set(id, Math.max(10, s.viewers));
    const base = baseline.get(id);
    const mode = i % 3; // 0 climber, 1 flat, 2 fader
    const target = mode === 0 ? base * 1.6 : mode === 2 ? base * 0.6 : base;
    // Move 12% of the way toward the target, plus a little noise, so the
    // approach is visible for a few minutes and then settles.
    const pull = (target - s.viewers) * 0.12;
    const noise = s.viewers * (Math.random() - 0.5) * 0.04;
    const next = Math.max(3, Math.round(s.viewers + pull + noise));
    return {
      updateOne: {
        filter: { _id: s._id },
        update: [
          { $set: { viewers: next } },
          { $set: { peakViewers: { $max: ["$peakViewers", next] } } },
        ],
      },
    };
  });
  if (ops.length) await streams.bulkWrite(ops, { ordered: false });
  process.stdout.write(`drift: nudged ${ops.length} live streams at ${new Date().toISOString().slice(11, 19)}\n`);
}

await tick();
setInterval(() => tick().catch((e) => console.error("drift tick failed:", e.message)), EVERY_MS);
