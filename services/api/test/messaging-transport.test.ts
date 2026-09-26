import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; this pure helper is exercised
// from here (the repo's only vitest) via a relative import. It is the fetch
// the messaging SDK runs on in the browser.
import { createCorsSafeFetch } from "../../lib/messaging-transport";

/** A fetch that records what it was asked to send. */
function recorder() {
  const calls: Array<{ url: string; headers: Headers; init?: RequestInit }> =
    [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      init,
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls, fetch: createCorsSafeFetch(fake) };
}

const API = "https://social-api.example/v1/messaging/conversations";

describe("createCorsSafeFetch", () => {
  it("moves the platform header into the query string", async () => {
    const { calls, fetch } = recorder();
    await fetch(API, {
      headers: { Authorization: "Bearer t", "x-ws-platform": "xstream" },
    });

    // The disallowed header is gone, so the browser's preflight passes…
    expect(calls[0].headers.has("x-ws-platform")).toBe(false);
    // …and the gateway still learns who is calling.
    expect(new URL(calls[0].url).searchParams.get("platform")).toBe("xstream");
    expect(calls[0].headers.get("Authorization")).toBe("Bearer t");
  });

  it("keeps the query the SDK already built", async () => {
    const { calls, fetch } = recorder();
    await fetch(`${API}?limit=50&before=abc`, {
      headers: { "x-ws-platform": "xstream" },
    });
    const params = new URL(calls[0].url).searchParams;
    expect(params.get("limit")).toBe("50");
    expect(params.get("before")).toBe("abc");
    expect(params.get("platform")).toBe("xstream");
  });

  it("never overrides a platform the caller set explicitly", async () => {
    const { calls, fetch } = recorder();
    await fetch(`${API}?platform=worldspace`, {
      headers: { "x-ws-platform": "xstream" },
    });
    expect(new URL(calls[0].url).searchParams.get("platform")).toBe(
      "worldspace",
    );
  });

  it("leaves requests without the header untouched", async () => {
    const { calls, fetch } = recorder();
    // The realtime token request: Authorization only, platform already in
    // the query — it must pass through byte for byte.
    const url = `${API}/realtime/token?platform=xstream`;
    await fetch(url, { headers: { Authorization: "Bearer t" } });
    expect(calls[0].url).toBe(url);
  });

  it("keeps the body, method and content type", async () => {
    const { calls, fetch } = recorder();
    const body = JSON.stringify({ content: "gm" });
    await fetch(API, {
      method: "POST",
      body,
      headers: {
        "x-ws-platform": "xstream",
        "Content-Type": "application/json",
      },
    });
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBe(body);
    expect(calls[0].headers.get("Content-Type")).toBe("application/json");
  });

  it("does not invent a content type for uploads", async () => {
    const { calls, fetch } = recorder();
    // FormData must go out without a Content-Type so the browser can add
    // the multipart boundary itself.
    await fetch(API, {
      method: "POST",
      body: new FormData(),
      headers: { "x-ws-platform": "xstream" },
    });
    expect(calls[0].headers.has("Content-Type")).toBe(false);
  });
});
