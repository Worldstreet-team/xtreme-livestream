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
 * Safely parse JSON response, returning error response on failure.
 */
async function safeJsonParse(res: Response): Promise<AuthResponse> {
  try {
    const text = await res.text();
    if (!text) {
      return { success: false, message: "Empty response from auth service" };
    }
    return JSON.parse(text);
  } catch {
    return { success: false, message: "Invalid JSON response from auth service" };
  }
}

/**
 * Verify an access token with the external auth service.
 */
export async function verifyToken(accessToken: string): Promise<AuthResponse> {
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/verify`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return { success: false, message: `Auth service returned ${res.status}` };
    }

    return await safeJsonParse(res);
  } catch (err) {
    console.error("[AuthService] verifyToken error:", err);
    return { success: false, message: "Failed to reach auth service" };
  }
}

/**
 * Refresh tokens using the refresh token.
 */
export async function refreshTokens(
  refreshToken: string
): Promise<AuthResponse> {
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });

    if (!res.ok) {
      return { success: false, message: `Refresh returned ${res.status}` };
    }

    return await safeJsonParse(res);
  } catch (err) {
    console.error("[AuthService] refreshTokens error:", err);
    return { success: false, message: "Failed to refresh tokens" };
  }
}

/**
 * Logout and invalidate the refresh token.
 */
export async function logoutUser(refreshToken: string): Promise<AuthResponse> {
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });

    if (!res.ok) {
      return { success: false, message: `Logout returned ${res.status}` };
    }

    return await safeJsonParse(res);
  } catch (err) {
    console.error("[AuthService] logoutUser error:", err);
    return { success: false, message: "Failed to logout" };
  }
}
