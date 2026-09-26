/**
 * The fetch the messaging SDK runs on in the browser.
 *
 * The SDK stamps every request with an `x-ws-platform` header so a thread
 * remembers where it was opened. The gateway's CORS allowlist (security
 * pass, 2026-09-24) does not name that header, so every browser preflight
 * fails and messaging never reaches the server — native apps don't preflight
 * and never noticed. The gateway reads `?platform=` as the very same thing
 * (`platformOf` in its message controller), so move the value there: the
 * request no longer asks for a disallowed header, and provenance survives.
 *
 * Harmless once the gateway allows the header — delete it then. It lives
 * here rather than in the vendored SDK so a re-sync can't undo it.
 *
 * Pure and framework-free on purpose — exercised by
 * services/api/test/messaging-transport.test.ts.
 */

const PLATFORM_HEADER = "x-ws-platform";

export function createCorsSafeFetch(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const platform = headers.get(PLATFORM_HEADER);
    // The SDK always passes a string URL; anything else goes through as is.
    if (!platform || typeof input !== "string") return base(input, init);

    headers.delete(PLATFORM_HEADER);
    const url = new URL(input);
    if (!url.searchParams.has("platform")) {
      url.searchParams.set("platform", platform);
    }
    return base(url.toString(), { ...init, headers });
  };
}
