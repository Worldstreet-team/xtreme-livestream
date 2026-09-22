import "server-only"

/**
 * The real bodies of Vivid's server tools. Executed only by
 * app/api/vivid/function/route.ts, which checks Clerk and the Vivid paywall,
 * mints the user's Clerk session JWT and passes it as `token`. Every call
 * here goes to the Fastify API on the user's behalf with that token — the API
 * has no service key, and it must not: these tools do exactly what the user
 * could do from the page, nothing more.
 */

import type { VoiceFunctionConfig } from "@/lib/vivid/types"
import { centsToDollars } from "@/lib/gifts"

type Ctx = { userId: string; token: string | null }

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "")

class ApiCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

async function api<T = unknown>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new ApiCallError("NEXT_PUBLIC_API_URL is not set", 0)
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  })
  const raw = await res.text()
  let json: { success?: boolean; data?: T; message?: string; code?: string } | null = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = null
  }
  if (!res.ok) throw new ApiCallError(json?.message ?? `Request failed (${res.status})`, res.status, json?.code)
  return (json?.data ?? json) as T
}

function fail(err: unknown, fallback: string): { error: string } {
  if (err instanceof ApiCallError) return { error: err.message }
  return { error: err instanceof Error ? err.message : fallback }
}

type StreamRow = {
  _id?: string
  id?: string
  title: string
  category: string
  viewers: number
  startedAt?: string
  streamerId?: { username?: string; displayName?: string } | string
  streamer?: { username?: string; displayName?: string }
}

function streamerName(s: StreamRow): string | null {
  const st = (typeof s.streamerId === "object" && s.streamerId) || s.streamer
  return st?.displayName || st?.username || null
}

function liveFor(startedAt?: string): string | null {
  if (!startedAt) return null
  const mins = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000))
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`
}

function tool<P extends Record<string, unknown>>(
  name: string,
  handler: (params: P & Ctx) => Promise<unknown>,
): VoiceFunctionConfig {
  return {
    name,
    description: "",
    parameters: { type: "object", properties: {} },
    handler: handler as unknown as (p: Record<string, unknown>) => Promise<unknown>,
    executionContext: "server",
  }
}

export const serverFunctions: VoiceFunctionConfig[] = [
  tool<{ category?: string; search?: string; sort?: string }>("listLiveStreams", async ({ token, category, search, sort }) => {
    try {
      const qs = new URLSearchParams({ live: "true", limit: "12", sort: sort === "trending" || sort === "recent" ? sort : "viewers" })
      if (category) qs.set("category", category)
      if (search) qs.set("search", search)
      const data = await api<{ streams: StreamRow[]; pagination?: { total?: number } }>(`/api/streams?${qs}`, token)
      const streams = (data.streams ?? []).map((s) => ({
        id: s._id ?? s.id,
        title: s.title,
        streamer: streamerName(s),
        category: s.category,
        viewers: s.viewers,
        liveFor: liveFor(s.startedAt),
      }))
      return { count: streams.length, totalLive: data.pagination?.total ?? streams.length, streams }
    } catch (err) {
      return fail(err, "Couldn't load live streams")
    }
  }),

  tool<{ query?: string }>("findChannel", async ({ token, query }) => {
    const q = (query ?? "").trim()
    if (!q) return { error: "Say who to look for." }
    try {
      const data = await api<{ channels: Array<Record<string, unknown> & { stream?: { id: string; title: string; viewers: number } | null }> }>(
        `/api/users/search?q=${encodeURIComponent(q)}&limit=5`,
        token,
      )
      const channels = (data.channels ?? []).map((c) => ({
        username: c.username,
        displayName: c.displayName,
        followers: c.followers,
        isLive: Boolean(c.isLive),
        ...(c.stream ? { streamId: c.stream.id, streamTitle: c.stream.title, viewers: c.stream.viewers } : {}),
      }))
      return channels.length ? { channels } : { channels: [], note: `No channel matches "${q}".` }
    } catch (err) {
      return fail(err, "Couldn't search channels")
    }
  }),

  tool<{ username?: string; follow?: boolean }>("followChannel", async ({ token, username, follow }) => {
    const u = (username ?? "").trim().replace(/^@/, "")
    if (!u) return { error: "Which channel?" }
    const wantFollow = follow !== false
    try {
      await api(`/api/user/${encodeURIComponent(u)}/follow`, token, { method: wantFollow ? "POST" : "DELETE" })
      return { success: true, username: u, following: wantFollow }
    } catch (err) {
      if (err instanceof ApiCallError && (err.code === "ALREADY_FOLLOWING" || err.code === "NOT_FOLLOWING")) {
        return { success: true, username: u, following: wantFollow, note: "already the case" }
      }
      if (err instanceof ApiCallError && err.code === "SELF_FOLLOW") return { error: "They can't follow themselves." }
      if (err instanceof ApiCallError && err.status === 404) return { error: `No channel called "${u}".` }
      return fail(err, "Couldn't update the follow")
    }
  }),

  tool("listFollowing", async ({ token }) => {
    try {
      const data = await api<{ channels: Array<{ username: string; displayName: string; isLive?: boolean; liveStream?: { id?: string; _id?: string; title: string; viewers: number } | null }> }>(
        `/api/user/me/following`,
        token,
      )
      const channels = (data.channels ?? []).map((c) => ({
        username: c.username,
        displayName: c.displayName,
        isLive: Boolean(c.liveStream),
        ...(c.liveStream ? { streamId: c.liveStream.id ?? c.liveStream._id, streamTitle: c.liveStream.title, viewers: c.liveStream.viewers } : {}),
      }))
      return { count: channels.length, liveNow: channels.filter((c) => c.isLive).length, channels }
    } catch (err) {
      return fail(err, "Couldn't load followed channels")
    }
  }),

  tool<{ title?: string; category?: string }>("updateStreamInfo", async ({ token, title, category }) => {
    const patch: Record<string, string> = {}
    if (typeof title === "string" && title.trim()) patch.title = title.trim().slice(0, 100)
    if (typeof category === "string" && category.trim()) patch.category = category.trim()
    if (!Object.keys(patch).length) return { error: "Nothing to change — give a title or a category." }
    try {
      const mine = await api<{ stream: { id: string } | null }>(`/api/streams/active/mine`, token)
      if (!mine.stream) return { error: "They aren't live right now." }
      const updated = await api<{ stream?: StreamRow } | StreamRow>(`/api/streams/${mine.stream.id}`, token, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      const s = ("stream" in updated && updated.stream ? updated.stream : updated) as StreamRow
      return { success: true, title: s.title ?? patch.title, category: s.category ?? patch.category }
    } catch (err) {
      return fail(err, "Couldn't update the stream")
    }
  }),

  tool("getLiveStats", async ({ token }) => {
    try {
      const mine = await api<{ stream: (StreamRow & { id: string; startedAt?: string; peakViewers?: number }) | null }>(`/api/streams/active/mine`, token)
      if (!mine.stream) return { live: false, note: "They aren't live right now." }
      const s = mine.stream
      let supporters: unknown[] = []
      try {
        const top = await api<{ supporters?: unknown[]; top?: unknown[] }>(`/api/streams/${s.id}/gifts/top`, token)
        supporters = top.supporters ?? top.top ?? []
      } catch {
        // Not worth failing the whole answer over.
      }
      return {
        live: true,
        title: s.title,
        category: s.category,
        viewers: s.viewers,
        peakViewers: s.peakViewers,
        liveFor: liveFor(s.startedAt),
        topSupporters: supporters,
      }
    } catch (err) {
      return fail(err, "Couldn't load stream stats")
    }
  }),

  tool("getWalletBalance", async ({ token }) => {
    try {
      const b = await api<{ availableUsdMinor: number; lockedUsdMinor: number; currency: string }>(`/api/wallet/balance`, token)
      return {
        available: centsToDollars(b.availableUsdMinor ?? 0),
        locked: centsToDollars(b.lockedUsdMinor ?? 0),
        currency: b.currency ?? "USD",
        note: "This is the Xtreme dollar wallet, shared with the Worldstreet Dollar Account.",
      }
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 503) return { error: "The wallet is unavailable right now." }
      return fail(err, "Couldn't load the wallet balance")
    }
  }),

  tool("getCreatorEarnings", async ({ token }) => {
    try {
      const [earn, dash] = await Promise.all([
        api<{ earnings: { balanceUsdMinor: number; receivedUsdMinor: number; receivedCount: number; sentUsdMinor: number; sentCount: number } }>(`/api/user/me/earnings`, token),
        api<{ stats?: Record<string, unknown> }>(`/api/dashboard/stats`, token).catch(() => ({ stats: undefined })),
      ])
      const e = earn.earnings
      return {
        earningsBalance: centsToDollars(e?.balanceUsdMinor ?? 0),
        giftsReceived: { total: centsToDollars(e?.receivedUsdMinor ?? 0), count: e?.receivedCount ?? 0 },
        giftsSent: { total: centsToDollars(e?.sentUsdMinor ?? 0), count: e?.sentCount ?? 0 },
        ...(dash.stats ? { stats: dash.stats } : {}),
      }
    } catch (err) {
      return fail(err, "Couldn't load earnings")
    }
  }),

  tool("getPoints", async ({ token }) => {
    try {
      const [points, payouts] = await Promise.all([
        api<{ balance: number; streakDays: number; ledger: unknown[] }>(`/api/user/me/points`, token),
        api<{ rules?: Record<string, unknown> }>(`/api/user/me/payouts`, token).catch(() => ({ rules: undefined })),
      ])
      return {
        balance: points.balance,
        worth: centsToDollars(Math.floor((points.balance ?? 0) / 10)),
        streakDays: points.streakDays,
        recent: (points.ledger ?? []).slice(0, 8),
        ...(payouts.rules ? { redeemRules: payouts.rules } : {}),
      }
    } catch (err) {
      return fail(err, "Couldn't load points")
    }
  }),

  tool<{ limit?: number }>("getNotifications", async ({ token, limit }) => {
    const n = Math.min(20, Math.max(1, Math.floor(Number(limit) || 10)))
    try {
      const data = await api<{ notifications: unknown[]; unread: number }>(`/api/user/me/notifications?limit=${n}`, token)
      return { unread: data.unread, notifications: data.notifications ?? [] }
    } catch (err) {
      return fail(err, "Couldn't load notifications")
    }
  }),
]
