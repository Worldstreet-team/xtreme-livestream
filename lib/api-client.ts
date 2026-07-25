/**
 * Client-side API helper.
 *
 * Every data request goes to the standalone Fastify API (services/api) with
 * the Clerk session JWT as a Bearer token — cross-origin, so cookies won't
 * ride along. NEXT_PUBLIC_API_URL is therefore required, not optional: the
 * in-process Next.js routes it used to fall back to have been removed, since
 * they had drifted out of sync with the real API (missing likes, reports,
 * gifts and the wallet, and accepting client-supplied tip amounts).
 *
 * A missing base URL used to degrade silently — likes and reports 404'd into
 * empty catch blocks and the landing page quietly showed placeholder data.
 * It now throws, so a misconfigured deploy is obvious immediately.
 */

/** Base URL of the standalone API service. Required. */
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

  if (!API_BASE && url.startsWith("/")) {
    throw new ApiError(
      "The app is misconfigured: NEXT_PUBLIC_API_URL is not set, so there is no API to talk to.",
      0,
      null
    );
  }

  const target = url.startsWith("/") ? `${API_BASE}${url}` : url;

  const token = await getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

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
