/**
 * Client-side API helper.
 * 
 * Authentication is handled by Clerk — the Clerk session cookie is
 * automatically included with same-origin requests. The server uses
 * Clerk's auth() to verify the caller.
 */

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

/**
 * Wrapper around fetch that sends credentials (httpOnly cookies).
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

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // Send httpOnly cookies automatically
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(data.message || "Request failed", res.status, data);
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
