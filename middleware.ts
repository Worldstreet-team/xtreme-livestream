import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  "/api/webhooks/(.*)",      // Server-to-server webhooks (verified by signature)
  "/sign-in(.*)",            // Local standalone sign-in (non-satellite dev)
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

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
