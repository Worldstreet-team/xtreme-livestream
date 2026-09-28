/**
 * Where "Sign in" goes, the way WorldSpace does it.
 *
 * In production this app is a Clerk satellite of the worldstreetgold.com hub
 * and auth happens there (middleware.ts). Locally (a pk_test_ key) it runs
 * standalone against the Clerk test instance with its own /sign-in page.
 *
 * Either way every "Sign in" in the app points at our own /sign-in: locally
 * that's the page itself; in production the middleware hands you to the
 * hub's /login with the page you were on as the way back, so you land where
 * you started instead of on the hub.
 */
export const HUB_ORIGIN = "https://www.worldstreetgold.com";
export const HUB_SIGN_IN = `${HUB_ORIGIN}/login`;
export const HUB_REGISTER = `${HUB_ORIGIN}/register`;

/** Local dev runs on a pk_test_ key; production is the hub's satellite (as WorldSpace decides it). */
export const isLocalClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_"));

/** A plain link: /sign-in brings you back to the page the link was on. */
export const SIGN_IN_URL = "/sign-in";

/** Sign in, then come back to `returnTo` (a path or a URL of ours). */
export function signInHref(returnTo?: string) {
  if (!returnTo) return SIGN_IN_URL;
  return `${SIGN_IN_URL}?redirect_url=${encodeURIComponent(returnTo)}`;
}

/** Where signing out lands: the hub in production, Explore locally. */
export const SIGNED_OUT_URL = isLocalClerk ? "/explore" : HUB_SIGN_IN;

/** Query keys the sign-in loop guards add (middleware.ts); never part of a way back. */
const GUARD_KEYS = ["__xt_hs", "__xt_retry"];

/**
 * Where to come back to after signing in: the `redirect_url` asked for, else
 * the page the link was on (its Referer), else Explore. Only ever a page on
 * `origin`, so /sign-in can't be used to bounce someone to another site.
 */
export function signInReturn(origin: string, asked: string | null, referer: string | null): URL {
  const own = (raw: string | null): URL | null => {
    if (!raw) return null;
    try {
      const url = new URL(raw, origin);
      if (url.origin !== origin) return null;
      if (url.pathname.startsWith("/sign-in") || url.pathname.startsWith("/sign-up")) return null;
      for (const k of GUARD_KEYS) url.searchParams.delete(k);
      return url;
    } catch {
      return null;
    }
  };
  return own(asked) ?? own(referer) ?? new URL("/explore", origin);
}
