import { describe, expect, it } from "vitest";

/**
 * The preview key's hash lives on the real Stream schema as `select: false`:
 * no ordinary read — a list, a page, a populate — ever loads it. Checked
 * against the real model (the route tests run on a fake store).
 */
const { Stream } = await import("../src/models.js");

describe("the preview key on the Stream schema", () => {
  it("is select: false, hash and timestamp both", () => {
    expect(Stream.schema.path("previewKeyHash")?.options.select).toBe(false);
    expect(Stream.schema.path("previewSharedAt")?.options.select).toBe(false);
    expect(Stream.schema.path("previewKeyHash")?.options.default).toBeNull();
  });

  it("is projected out of an ordinary query, and in only when asked for", () => {
    const plain = Stream.find({ isLive: true }) as unknown as { _applyPaths(): void; _fields?: Record<string, unknown> };
    plain._applyPaths();
    expect(plain._fields).toMatchObject({ previewKeyHash: 0, previewSharedAt: 0 });

    const asked = Stream.findOne({}).select("+previewKeyHash") as unknown as { _applyPaths(): void; _fields?: Record<string, unknown> };
    asked._applyPaths();
    expect(asked._fields?.previewKeyHash).not.toBe(0);
  });
});
