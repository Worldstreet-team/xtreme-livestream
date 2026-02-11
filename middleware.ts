import { NextRequest, NextResponse } from "next/server";

const LOGIN_URL = "https://www.worldstreetgold.com/login";

/**
 * Paths that don't require authentication.
 * These include Next.js internals, static assets, and API auth routes.
 */
const PUBLIC_PATHS = [
  "/api/auth", // Our auth endpoints
  "/_next",
  "/favicon.ico",
  "/images",
  "/public",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths (static assets, auth API, etc.)
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check for authentication tokens
  const accessToken = request.cookies.get("accessToken")?.value;
  const refreshToken = request.cookies.get("refreshToken")?.value;

  // No tokens at all = redirect to external login
  if (!accessToken && !refreshToken) {
    const returnUrl = request.url;
    const loginUrl = `${LOGIN_URL}?redirect=${encodeURIComponent(returnUrl)}`;
    return NextResponse.redirect(loginUrl);
  }

  // Tokens exist — let the request through
  // (actual verification happens in the API routes / auth context)
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|images).*)",
  ],
};
