import { describe, expect, it } from "vitest";
import {
  createChatMessageBodySchema,
  createStreamBodySchema,
  listStreamsQuerySchema,
  updateProfileBodySchema,
} from "@xtreme/contracts";

describe("API contracts", () => {
  it("coerces and bounds stream pagination", () => {
    const query = listStreamsQuerySchema.parse({
      page: "2",
      limit: "50",
      live: "true",
    });

    expect(query).toMatchObject({ page: 2, limit: 50, live: "true" });
    expect(() => listStreamsQuerySchema.parse({ limit: "51" })).toThrow();
  });

  it("accepts free-form categories but bounds them", () => {
    // Category is deliberately a free string (the socials app streams with
    // its own 100-category taxonomy) — only emptiness and length are policed.
    expect(
      createStreamBodySchema.parse({
        title: "Morning market",
        category: "Football",
      }).category,
    ).toBe("Football");
    expect(() =>
      createStreamBodySchema.parse({ title: "Morning market", category: "" }),
    ).toThrow();
    expect(() =>
      createStreamBodySchema.parse({
        title: "Morning market",
        category: "x".repeat(49),
      }),
    ).toThrow();
  });

  it("limits persisted chat messages", () => {
    expect(() =>
      createChatMessageBodySchema.parse({ content: "x".repeat(501) }),
    ).toThrow();
  });

  it("normalizes usernames", () => {
    const profile = updateProfileBodySchema.parse({
      username: "  Market_Wizard  ",
    });

    expect(profile.username).toBe("market_wizard");
  });
});
