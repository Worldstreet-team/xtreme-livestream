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

  it("rejects unknown stream categories", () => {
    expect(() =>
      createStreamBodySchema.parse({
        title: "Morning market",
        category: "Not a category",
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
