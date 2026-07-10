import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

describe("service surface", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes a liveness endpoint without a database", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "xtreme-api",
    });
  });

  it("reports not ready while MongoDB is disconnected", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      database: "disconnected",
    });
  });

  it("publishes OpenAPI documentation", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/docs/json",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      info: { title: "Xtreme Worldstreet API" },
    });
  });

  it("accepts LiveKit's webhook content type before signature validation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/livekit",
      headers: {
        "content-type": "application/webhook+json",
        authorization: "Bearer invalid-livekit-signature",
      },
      payload: "{}",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      code: "INVALID_WEBHOOK_SIGNATURE",
    });
  });

  it("returns the standard error envelope for unknown routes", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/not-a-route",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      code: "NOT_FOUND",
    });
  });
});
