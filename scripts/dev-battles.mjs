// Local dev only: keep battles on the page. Seeded rooms have no real
// broadcasts, so nobody ever challenges anybody — this books a few ahead,
// keeps two running at any moment (the API's sweep settles each one when
// its clock runs out, and the next tick starts a fresh pair), and drips
// gifts into the live ones so the score bar moves. Used by seed-dev.mjs
// once and by drift-dev.mjs on every tick.

const LIVE_TARGET = 2;
const BOOKED_TARGET = 3;
const DURATION_SEC = 300;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export async function ensureBattles(db) {
  const battles = db.collection("battles");
  const streams = db.collection("streams");
  const now = Date.now();

  const running = await battles.find({ status: { $in: ["live", "overtime"] }, endsAt: { $gt: new Date(now) } }).toArray();
  const booked = await battles.find({ status: "scheduled", scheduledAt: { $gt: new Date(now) } }).toArray();
  const busy = new Set(running.flatMap((b) => [String(b.hostStreamId), String(b.challengerStreamId)]));
  const live = await streams.find({ isLive: true }).project({ streamerId: 1, viewers: 1 }).toArray();
  const free = live.filter((s) => !busy.has(String(s._id))).sort(() => Math.random() - 0.5);

  // Gifts land in the running battles — a few dollars a tick, now and then a big one.
  for (const b of running) {
    const side = Math.random() < 0.55 ? "hostUsdMinor" : "challengerUsdMinor";
    const amount = pick([100, 200, 500, 500, 1000, 2500, 5000]) * (Math.random() < 0.08 ? 10 : 1);
    await battles.updateOne({ _id: b._id }, { $inc: { [side]: amount, commissionUsdMinor: Math.round(amount * 0.2) } });
  }

  const docs = [];
  for (let i = running.length; i < LIVE_TARGET && free.length >= 2; i++) {
    const [a, b] = free.splice(0, 2);
    const left = 60 + Math.floor(Math.random() * 220);
    docs.push({
      hostId: a.streamerId,
      challengerId: b.streamerId,
      hostStreamId: a._id,
      challengerStreamId: b._id,
      status: "live",
      durationSec: DURATION_SEC,
      multiplierWindowSec: 30,
      multiplier: 2,
      invitedAt: new Date(now - (DURATION_SEC - left) * 1000 - 5000),
      scheduledAt: null,
      startsAt: new Date(now - (DURATION_SEC - left) * 1000),
      endsAt: new Date(now + left * 1000),
      hostUsdMinor: 100 * (40 + Math.floor(Math.random() * 900)),
      challengerUsdMinor: 100 * (40 + Math.floor(Math.random() * 900)),
      commissionUsdMinor: 0,
      winnerId: null,
      bonusUsdMinor: 0,
      overtimeUsed: false,
      endedReason: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  }

  // Booked battles, a few hours apart, between whoever is on air.
  const pool = live.slice().sort(() => Math.random() - 0.5);
  for (let i = booked.length; i < BOOKED_TARGET && pool.length >= 2; i++) {
    const [a, b] = pool.splice(0, 2);
    const at = new Date(now + (i + 1) * 2.5 * 3600_000);
    docs.push({
      hostId: a.streamerId,
      challengerId: b.streamerId,
      hostStreamId: a._id,
      challengerStreamId: b._id,
      status: "scheduled",
      durationSec: DURATION_SEC,
      multiplierWindowSec: 30,
      multiplier: 2,
      invitedAt: new Date(now),
      scheduledAt: at,
      startsAt: null,
      endsAt: null,
      hostUsdMinor: 0,
      challengerUsdMinor: 0,
      commissionUsdMinor: 0,
      winnerId: null,
      bonusUsdMinor: 0,
      overtimeUsed: false,
      endedReason: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  }

  if (docs.length) await battles.insertMany(docs);
  return { running: running.length, started: docs.filter((d) => d.status === "live").length, booked: booked.length + docs.filter((d) => d.status === "scheduled").length };
}
