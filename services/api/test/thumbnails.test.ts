import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { parseImageDataUri, thumbnailUrlFor } from "../src/stream-service.js";

/**
 * A one-pixel JPEG is enough to prove the round-trip: what goes into the
 * document as base64 comes back out as the identical bytes.
 */
const PIXEL = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const PIXEL_DATA_URI = `data:image/jpeg;base64,${PIXEL.toString("base64")}`;

const STREAM_ID = "a".repeat(24);

/** Whatever the next `Stream.findById(...).select(...).lean()` resolves to. */
let storedStream: Record<string, unknown> | null = null;

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: () => ({
      select: () => ({ lean: async () => storedStream }),
    }),
  },
  // The route module imports these at load time even though this suite
  // never exercises the paths that touch them.
  ChatMessage: {},
  Follow: {},
  Report: {},
  StreamLike: {},
  User: {},
}));

describe("parseImageDataUri", () => {
  it("decodes a base64 image data URI to its bytes", () => {
    const parsed = parseImageDataUri(PIXEL_DATA_URI);

    expect(parsed?.contentType).toBe("image/jpeg");
    expect(parsed?.body.equals(PIXEL)).toBe(true);
  });

  it("rejects anything that isn't an inline image", () => {
    expect(parseImageDataUri("https://example.com/a.jpg")).toBeNull();
    expect(parseImageDataUri("data:text/html;base64,PHA+")).toBeNull();
    expect(parseImageDataUri("")).toBeNull();
  });
});

describe("thumbnailUrlFor", () => {
  it("versions the URL so a replaced thumbnail is a different URL", () => {
    expect(
      thumbnailUrlFor({ _id: STREAM_ID, thumbnail: PIXEL_DATA_URI, thumbnailVersion: 42 }),
    ).toBe(`/api/streams/${STREAM_ID}/thumbnail?v=42`);
  });

  it("infers presence from the version when the blob is projected out", () => {
    // This is the case that matters: list endpoints never load `thumbnail`.
    expect(thumbnailUrlFor({ _id: STREAM_ID, thumbnailVersion: 7 })).toBe(
      `/api/streams/${STREAM_ID}/thumbnail?v=7`,
    );
    expect(thumbnailUrlFor({ _id: STREAM_ID, thumbnailVersion: 0 })).toBeNull();
  });

  it("returns null for a stream with no thumbnail", () => {
    expect(
      thumbnailUrlFor({ _id: STREAM_ID, thumbnail: "", thumbnailVersion: 0 }),
    ).toBeNull();
  });
});

describe("GET /streams/:id/thumbnail", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (headers: Record<string, string> = {}) =>
    app.inject({
      method: "GET",
      url: `/api/streams/${STREAM_ID}/thumbnail`,
      headers,
    });

  it("serves the decoded image with a long-lived, versioned cache", async () => {
    storedStream = { thumbnail: PIXEL_DATA_URI, thumbnailVersion: 99 };
    const response = await get();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.etag).toBe('"thumb-99"');
    expect(response.rawPayload.equals(PIXEL)).toBe(true);
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    storedStream = { thumbnail: PIXEL_DATA_URI, thumbnailVersion: 99 };
    const response = await get({ "if-none-match": '"thumb-99"' });

    expect(response.statusCode).toBe(304);
    expect(response.rawPayload.length).toBe(0);
  });

  it("re-sends the image when the version has moved on", async () => {
    storedStream = { thumbnail: PIXEL_DATA_URI, thumbnailVersion: 100 };
    const response = await get({ "if-none-match": '"thumb-99"' });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"thumb-100"');
  });

  it("redirects rather than proxying an externally hosted thumbnail", async () => {
    storedStream = {
      thumbnail: "https://images.example.com/a.jpg",
      thumbnailVersion: 5,
    };
    const response = await get();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://images.example.com/a.jpg");
  });

  it("404s when the stream has no thumbnail", async () => {
    storedStream = { thumbnail: "", thumbnailVersion: 0 };
    const response = await get();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NO_THUMBNAIL" });
  });

  it("404s when the stream doesn't exist", async () => {
    storedStream = null;
    const response = await get();

    expect(response.statusCode).toBe(404);
  });

  it("rejects a malformed id before touching the database", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/streams/not-an-object-id/thumbnail",
    });

    expect(response.statusCode).toBe(400);
  });
});
