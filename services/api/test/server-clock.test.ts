import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { recordServerTime, serverOffset } from "../../../lib/server-clock";

/**
 * One clock for everyone: the API stamps every answer with its time
 * (readable across origins), and the app keeps the median offset from
 * quick round trips — so countdowns and on-screen timers agree on every
 * device, whatever its own clock says.
 */

describe("the server's clock", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("stamps every answer, and lets browsers read the stamp", async () => {
    const before = Date.now();
    const response = await app.inject({ method: "GET", url: "/health/live", headers: { origin: "http://localhost:3010" } });

    const stamp = Number(response.headers["x-server-time"]);
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Date.now());
    expect(String(response.headers["access-control-expose-headers"])).toContain("X-Server-Time");
  });

  it("keeps the median offset of quick round trips, and ignores slow ones", () => {
    // This device runs 60 s behind the server.
    const t = 1_000_000;
    recordServerTime(t + 60_000 + 50, t, t + 100); // rtt 100: offset 60,000
    recordServerTime(t + 60_000 + 20, t, t + 40); // rtt 40: offset 60,000
    recordServerTime(t + 90_000, t, t + 10); // a bad sample: offset 89,995
    expect(serverOffset()).toBe(60_000);

    // A 9-second round trip says little about when it was stamped.
    recordServerTime(t, t, t + 9_000);
    expect(serverOffset()).toBe(60_000);
  });
});
