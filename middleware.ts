import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { HUB_ORIGIN, HUB_REGISTER, HUB_SIGN_IN, isLocalClerk, signInReturn } from "@/lib/auth-urls";

/**
 * Sign-in belongs to the WorldStreet hub, done the way WorldSpace does it
 * (worldstreetsocialmedia-client src/proxy.ts, owner 2026-09-28: "look at the
 * way social does its redirect when users sign in, do the same").
 *
 * In production this app is a Clerk SATELLITE of worldstreetgold.com, declared
 * in CODE below, not left to env (production had it off, so nobody was ever
 * handshaken: a visitor already signed in on the hub was sent to its /login
 * anyway, and every "Sign in" dropped them on the hub with no way back).
 *
 *  - Any page load without a session first handshakes with the hub
 *    (clerk.worldstreetgold.com). Someone signed in there comes back signed
 *    in here without seeing a form.
 *  - Only a protected page with genuinely nobody signed in goes to the hub's
 *    /login, with `redirect_url` set to where they were, so they land back on
 *    it (`auth.protect()` builds that — never hand-roll it: it skips the
 *    handshake and loops).
 *  - Every "Sign in" in the app goes through our own /sign-in, which sends
 *    you to the hub's /login with the page you came from as the way back.
 *  - Two loop breakers WorldSpace learned in production: the handshake
 *    ping-pong and the browser that keeps no cookies. Each gets a small page
 *    of ours instead of another redirect.
 *
 * Locally (a pk_test_ key) none of this runs: the app is standalone against
 * the Clerk test instance with its own /sign-in page.
 */

/**
 * Public routes that don't require Clerk authentication.
 * All other routes are protected by default.
 *
 * The data API lives in the standalone Fastify service (services/api) and is
 * reached cross-origin with a Clerk bearer token, so it never passes through
 * this middleware. The only route left under /api here is the LiveKit
 * webhook, which authenticates itself by signature.
 */
const isPublicRoute = createRouteMatcher([
  "/",                       // Marketing landing page
  "/explore",                // Public stream browsing
  "/stream/(.*)",            // Public stream watching (interactions still require auth)
  "/c/(.*)",                 // Public channel pages (following still requires auth)
  "/browse(.*)",             // Public category directory
  "/feed",                   // Public vertical live feed (muted previews)
  "/camera/(.*)",            // A second phone as a camera: the scanned code is its key, it has no account
  "/api/webhooks/(.*)",      // Server-to-server webhooks (verified by signature)
  "/sign-in(.*)",            // Sign in: our own page locally, a hand-off to the hub in production
  "/sign-up(.*)",
]);

/** The cookie-less loop guard's marker (see `middleware` below). */
const HS_MARK = "__xt_hs";

/** A Link prefetch or an RSC payload fetch: redirecting one poisons the router. */
function isSpeculative(req: NextRequest): boolean {
  const h = req.headers;
  return (
    h.get("Next-Router-Prefetch") === "1" ||
    h.get("purpose") === "prefetch" ||
    h.get("Purpose") === "prefetch" ||
    h.get("x-middleware-prefetch") === "1" ||
    h.has("RSC")
  );
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A small page of our own, in Xtream's dark ground, for the two loop breakers. */
function page(title: string, heading: string, body: string, extra = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Xtream</title>
${extra}
<style>html{background:#0b0a0a;color:#f2f2f3;font:15px/1.6 -apple-system,"DM Sans",system-ui,sans-serif}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px}
main{max-width:360px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{margin:0 0 20px;color:rgba(242,242,243,0.62)}
a{display:inline-block;background:#f2f2f3;color:#0b0a0a;font-weight:600;border-radius:9999px;padding:10px 20px;text-decoration:none}
small{display:block;margin-top:16px;color:rgba(242,242,243,0.42);word-break:break-all}</style>
</head><body><main>${heading}${body}</main></body></html>`;
}

/**
 * The handshake ping-pong breaker (WorldSpace, production 2026-09-11/16). A
 * failed hub sync leaves Clerk reporting the visitor signed out; protect()
 * sends them to the hub, the hub knows them and sends them straight back, and
 * round it goes until the browser gives up. First time: hold one beat and try
 * the handshake again. Second time: say so, and offer the hub's login as a
 * link, never a redirect.
 */
function handshakeLoopPage(req: NextRequest, retry: number): string {
  const again = new URL(req.nextUrl.href);
  again.searchParams.set("__xt_retry", String(retry + 1));
  const clean = new URL(req.nextUrl.href);
  clean.searchParams.delete("__xt_retry");
  const login = new URL(HUB_SIGN_IN);
  login.searchParams.set("redirect_url", clean.href);
  const retrying = retry < 1;
  return page(
    retrying ? "Signing you in" : "Sign in",
    `<h1>${retrying ? "Signing you in…" : "We couldn't sign you in here"}</h1>`,
    `<p>${
      retrying
        ? "Connecting your WorldStreet account to Xtream."
        : "Your WorldStreet sign-in didn't carry over to this device. Sign in once more and you'll come straight back."
    }</p>${retrying ? "" : `<a href="${esc(login.href)}">Sign in at WorldStreet</a>`}`,
    retrying ? `<meta http-equiv="refresh" content="2;url=${esc(again.href)}">` : "",
  );
}

/** For a browser that keeps no cookies (an in-app browser, a locked-down mode): no redirect, a way out. */
function cookiesOffPage(req: NextRequest): string {
  const clean = new URL(req.nextUrl.href);
  clean.searchParams.delete(HS_MARK);
  return page(
    "Open in your browser",
    "<h1>Open this in your browser</h1>",
    `<p>Xtream needs cookies to keep you signed in, and this browser isn't saving them. If you opened this link inside another app, use its menu to open the page in Safari or Chrome.</p><a href="${esc(clean.href)}">Try again</a><small>${esc(clean.href)}</small>`,
  );
}

const withClerk = clerkMiddleware(
  async (auth, req) => {
    if (isLocalClerk) {
      if (!isPublicRoute(req)) await auth.protect();
      return;
    }

    const { pathname } = req.nextUrl;
    const { userId } = await auth();

    // The cookie-less guard's marker has done its job once there's a session:
    // one redirect to the clean URL, so it never lingers in a shared link.
    if (userId && req.nextUrl.searchParams.has(HS_MARK)) {
      const clean = new URL(req.nextUrl.href);
      clean.searchParams.delete(HS_MARK);
      return NextResponse.redirect(clean, 307);
    }

    // "Sign in" / "Sign up" anywhere in the app: to the hub, with the way back.
    if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) {
      const back = signInReturn(req.nextUrl.origin, req.nextUrl.searchParams.get("redirect_url"), req.headers.get("referer"));
      if (userId) return NextResponse.redirect(back, 307);
      const hub = new URL(pathname.startsWith("/sign-up") ? HUB_REGISTER : HUB_SIGN_IN);
      hub.searchParams.set("redirect_url", back.href);
      return NextResponse.redirect(hub, 307);
    }

    if (isPublicRoute(req)) return;

    // See handshakeLoopPage. Only on protected pages: a public one never
    // sends a signed-out visitor to the hub, so it can't ping-pong.
    const referer = req.headers.get("referer") ?? "";
    const fromHub = referer.startsWith(`${HUB_ORIGIN}/`);
    if (!userId && !isSpeculative(req) && (req.cookies.get("__clerk_redirect_count")?.value === "3" || fromHub)) {
      const retry = Number(req.nextUrl.searchParams.get("__xt_retry")) || 0;
      console.warn(fromHub ? "[auth] hub bounced a signed-out visitor back" : "[auth] satellite handshake looped", {
        path: pathname,
        retry,
        referer,
        ua: req.headers.get("user-agent"),
        cookies: req.cookies.getAll().map((c) => c.name),
      });
      const res = new NextResponse(handshakeLoopPage(req, retry), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
      res.cookies.set("__clerk_redirect_count", "", { maxAge: 0, path: "/" });
      if (fromHub) {
        // A failed handshake leaves __client_uat=0, which stops the next one
        // from running; clear it (both copies) so the next hop handshakes
        // fresh — a real hub session then succeeds, a dead one shows the form.
        res.cookies.set("__client_uat", "", { maxAge: 0, path: "/", domain: "worldstreetgold.com" });
        res.cookies.set("__client_uat", "", { maxAge: 0, path: "/" });
        res.cookies.set("__session", "", { maxAge: 0, path: "/" });
      }
      return res;
    }

    // NOT a hand-rolled redirect to the hub: protect() performs the handshake
    // and, for someone genuinely signed out, sends them to the hub's /login
    // with this page as the way back.
    await auth.protect();
  },
  // Satellite config in code, mirroring WorldSpace, the dashboard, academy and arcade.
  isLocalClerk
    ? {}
    : { domain: "worldstreetgold.com", isSatellite: true, signInUrl: HUB_SIGN_IN, signUpUrl: HUB_REGISTER },
);

/**
 * The loop clerkMiddleware can't stop by itself (WorldSpace, 2026-09-16): on
 * a satellite, every session-less page load is sent to the hub's handshake,
 * which hands the session back IN A COOKIE. A browser that keeps none comes
 * back exactly as it left and is sent again, forever. Clerk's own counter is
 * a cookie too, so it never fires for that browser.
 *
 * So, in front of Clerk: a page load with no Cookie header at all and no
 * marker gets one self-redirect that adds the marker (and sets a probe
 * cookie, so a first-time visitor whose browser is fine arrives WITH a
 * cookie). Back with the marker and still no cookie means this browser keeps
 * none: say so on a page of ours instead of redirecting again.
 *
 * Only real page loads (`Sec-Fetch-Dest: document`, exactly what Clerk
 * handshakes): link-preview bots and crawlers don't send it, so shared
 * stream and channel links keep rendering their previews.
 */
export default function middleware(req: NextRequest, evt: NextFetchEvent) {
  const isDocument = req.method === "GET" && !isSpeculative(req) && req.headers.get("sec-fetch-dest") === "document";
  if (!isLocalClerk && isDocument && !req.headers.get("cookie")) {
    if (req.nextUrl.searchParams.get(HS_MARK) === "1") {
      console.warn("[auth] handshake returned with no cookies at all", {
        path: req.nextUrl.pathname,
        ua: req.headers.get("user-agent"),
        referer: req.headers.get("referer"),
      });
      return new NextResponse(cookiesOffPage(req), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    const marked = new URL(req.nextUrl.href);
    marked.searchParams.set(HS_MARK, "1");
    const res = NextResponse.redirect(marked, 307);
    res.cookies.set("xt_ck", "1", { path: "/", maxAge: 600, sameSite: "lax", secure: true });
    return res;
  }
  return withClerk(req, evt);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search
    // params. Media is listed too: a clip under public/ (the dev preview
    // loops) is a file, not a page, and must never be auth-gated.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|m4v|mov|mp3|m4a|ogg|wav)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
