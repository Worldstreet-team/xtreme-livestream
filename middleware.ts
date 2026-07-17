import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Public routes that don't require Clerk authentication.
 * All other routes are protected by default.
 */
const isPublicRoute = createRouteMatcher([
  "/",                       // Marketing landing page
  "/explore",                // Public stream browsing
  "/stream/(.*)",            // Public stream watching (interactions still require auth)
  "/api/streams(.*)",        // Public stream listing & details
  "/api/user/:username",     // Public user profiles
  "/api/webhooks/(.*)",      // Server-to-server webhooks (verified by signature)
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
