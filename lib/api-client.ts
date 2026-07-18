/**
 * Client-side API helper.
 *
 * Authentication is handled by Clerk. When NEXT_PUBLIC_API_URL is set,
 * requests go to the standalone Fastify API with the Clerk session JWT as
 * a Bearer token (cross-origin, cookies won't ride along). When unset,
 * requests fall back to the same-origin Next.js routes where the Clerk
 * session cookie is included automatically.
 */

/** Base URL of the standalone API service; empty string = same-origin. */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

interface ClerkGlobal {
  session?: { getToken(): Promise<string | null> } | null;
}

/** Clerk session JWT for cross-origin requests to the API service. */
async function getSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const clerk = (window as { Clerk?: ClerkGlobal }).Clerk;
    return (await clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

/**
 * Wrapper around fetch that attaches auth (Bearer token or cookies).
 * Returns the parsed JSON body.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const target = API_BASE && url.startsWith("/") ? `${API_BASE}${url}` : url;

  if (API_BASE) {
    const token = await getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(target, {
    ...options,
    headers,
    credentials: "include", // Send httpOnly cookies automatically
  });

  // Parse defensively: an error page, a misrouted request, or a gateway
  // failure can return HTML or an empty body. Calling res.json() directly
  // in those cases throws an opaque "Unexpected token '<'" error that hides
  // the real HTTP status, so read the text first and only parse if it's JSON.
  const raw = await res.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (res.ok) {
        throw new ApiError(
          "The server returned an unexpected response.",
          res.status,
          raw
        );
      }
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "message" in data
        ? (data as { message?: string }).message
        : undefined) ?? `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(message, res.status, data ?? raw);
  }

  return data as T;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}
