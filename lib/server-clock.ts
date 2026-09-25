/**
 * The server's clock, as this device reckons it. Every API answer carries
 * X-Server-Time; apiFetch hands each sample here with the request's round
 * trip, and the offset is the median of the recent ones — so a device
 * whose own clock is minutes off still shows countdowns and on-screen
 * timers the way everyone else sees them.
 */

const MAX_SAMPLES = 9;
const samples: number[] = [];
let offset = 0;

/** A server timestamp, read when the answer arrived after a round trip of `rttMs`. */
export function recordServerTime(serverMs: number, sentAt: number, receivedAt: number) {
  if (!Number.isFinite(serverMs) || receivedAt < sentAt) return;
  const rtt = receivedAt - sentAt;
  // Answers that took long say little about the moment they were stamped.
  if (rtt > 5_000) return;
  samples.push(serverMs + rtt / 2 - receivedAt);
  if (samples.length > MAX_SAMPLES) samples.shift();
  const sorted = [...samples].sort((a, b) => a - b);
  offset = sorted[Math.floor(sorted.length / 2)];
}

/** How far this device's clock is behind the server's (ms; negative when ahead). */
export function serverOffset() {
  return offset;
}

/** Now, on the server's clock. */
export function serverNow() {
  return Date.now() + offset;
}
