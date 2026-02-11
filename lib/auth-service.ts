/**
 * Client for the external WorldStreet authentication service.
 * Used by server-side routes to verify tokens and refresh them.
 */

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "https://api.worldstreetgold.com";

export interface AuthUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isVerified: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  data?: {
    user?: AuthUser;
    tokens?: AuthTokens;
  };
}

/**
 * Verify an access token with the external auth service.
 */
export async function verifyToken(accessToken: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/verify`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  return res.json();
}

/**
 * Refresh tokens using the refresh token.
 */
export async function refreshTokens(
  refreshToken: string
): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  return res.json();
}

/**
 * Logout and invalidate the refresh token.
 */
export async function logoutUser(refreshToken: string): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  return res.json();
}
