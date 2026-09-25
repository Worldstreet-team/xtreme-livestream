/**
 * Where "Sign in" goes. In production this app is a Clerk satellite of the
 * worldstreetgold.com hub and auth happens there; locally it runs standalone
 * against the Clerk test instance with its own /sign-in route (see
 * app/layout.tsx). The env names the URL in both cases — the hub is only the
 * fallback when satellite mode is on and nothing was set. Every sign-in link
 * reads it from here, so localhost never bounces you to the hub.
 */
const HUB_SIGN_IN = "https://www.worldstreetgold.com/login";
const isSatellite = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true";

export const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || (isSatellite ? HUB_SIGN_IN : "/sign-in");

/** Sign in, then come back to `returnTo` — only the local route takes a return address. */
export function signInHref(returnTo?: string) {
  if (!returnTo || !SIGN_IN_URL.startsWith("/")) return SIGN_IN_URL;
  return `${SIGN_IN_URL}?redirect_url=${encodeURIComponent(returnTo)}`;
}

/** Where signing out lands: the hub in production, Explore locally. */
export const SIGNED_OUT_URL = isSatellite ? HUB_SIGN_IN : "/explore";
