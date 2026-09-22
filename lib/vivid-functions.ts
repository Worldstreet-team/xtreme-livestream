/**
 * Vivid's tools on Xtreme.
 *
 * This file is bundled for the browser, so it must never import anything
 * server-side. Client tools have their real bodies here; server tools are
 * stubs whose real handlers live in lib/vivid-functions.server.ts and run
 * through /api/vivid/function (behind Clerk and the Vivid paywall).
 *
 * Rules, kept from the web app:
 * - Descriptions are written for the model: when to call it, what it returns.
 * - Client tools return plain objects the model can speak from. Never throw.
 * - Navigation dispatches vivid:navigate; the provider turns it into router.push.
 * - Anything that spends or ends something takes confirmed=true on a second
 *   call after a spoken yes, and refuses otherwise.
 */

import type { JSONSchema, VoiceFunctionConfig } from "@/lib/vivid/types"
import { apiFetch, ApiError } from "@/lib/api-client"
import { GIFT_CATALOG, centsToDollars } from "@/lib/gifts"
import {
  getPageInfo,
  getStudioBridge,
  readLiveContext,
  STUDIO_ACTIONS,
  type StudioAction,
} from "@/lib/vivid/page-context"

export type { VividAgentState, VoiceFunctionConfig, JSONSchema } from "@/lib/vivid/types"

// ── Schema helpers ──────────────────────────────────────────────────────────

type Prop = Record<string, unknown> & { _required?: boolean }

const stringParam = (description: string, required = false): Prop => ({ type: "string", description, _required: required })
const booleanParam = (description: string, required = false): Prop => ({ type: "boolean", description, _required: required })
const numberParam = (description: string, required = false): Prop => ({ type: "number", description, _required: required })
const enumParam = (description: string, options: readonly string[], required = false): Prop => ({
  type: "string",
  description,
  enum: [...options],
  _required: required,
})

function buildParameters(params: Record<string, Prop>): JSONSchema {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, { _required, ...schema }] of Object.entries(params)) {
    properties[key] = schema
    if (_required) required.push(key)
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) }
}

function define<P extends Record<string, unknown>, R>(fn: VoiceFunctionConfig<P, R>): VoiceFunctionConfig {
  return fn as unknown as VoiceFunctionConfig
}

/** A server tool's browser-side stub: the bridge routes it to /api/vivid/function. */
function serverStub(name: string, description: string, parameters: JSONSchema): VoiceFunctionConfig {
  return { name, description, parameters, handler: () => ({ error: "runs server-side" }), executionContext: "server" }
}

function errorOf(err: unknown, fallback: string): { error: string } {
  if (err instanceof ApiError) return { error: err.message }
  return { error: err instanceof Error ? err.message : fallback }
}

// ── Destinations ────────────────────────────────────────────────────────────

interface Destination {
  id: string
  label: string
  url: string
  external?: boolean
  /** Needs the signed-in user's username to build the URL. */
  needsUsername?: boolean
}

const DESTINATIONS: Destination[] = [
  { id: "home", label: "Home — live streams and discovery", url: "/explore" },
  { id: "browse", label: "Browse — categories and filters", url: "/browse" },
  { id: "feed", label: "Live feed — vertical swipe through live streams", url: "/feed" },
  { id: "following", label: "Following — the channels you're allied with", url: "/following" },
  { id: "studio", label: "Studio — go live and stream controls", url: "/studio" },
  { id: "dashboard", label: "Creator dashboard — stats", url: "/dashboard" },
  { id: "wallet", label: "Wallet — balance and earnings", url: "/wallet" },
  { id: "rewards", label: "Rewards — points and redeeming", url: "/rewards" },
  { id: "settings", label: "Settings — profile and stream settings", url: "/settings" },
  { id: "my_channel", label: "Your own channel page", url: "/c/", needsUsername: true },
  // Mirrors lib/ecosystem.ts. Kept as plain data here because that file
  // exports icon components, and this list is also read by the mint route on
  // the server where React components can't be evaluated.
  ...(
    [
      ["WorldSpace", "The social feed", "https://social.worldstreetgold.com"],
      ["Dashboard", "Wallet and portfolio", "https://dashboard.worldstreetgold.com"],
      ["Forex Markets", "Trade currency pairs", "https://dashboard.worldstreetgold.com/trade"],
      ["Cryptocurrencies", "Buy, sell and hold crypto", "https://dashboard.worldstreetgold.com/trade"],
      ["Vivid AI", "The assistant across the ecosystem", "https://worldstreetgold.com/vivid"],
      ["Academy", "Courses and market education", "https://academy.worldstreetgold.com"],
      ["e-Commerce", "The WorldStreet marketplace", "https://shop.worldstreetgold.com"],
      ["Prediction", "Markets on what happens next", "https://prediction.worldstreetgold.com"],
      ["Arcade", "Play and compete", "https://arcade.worldstreetgold.com"],
      ["Vision", "Watch and discover", "https://vision.worldstreetgold.com"],
    ] as const
  ).map(([title, description, href]) => ({
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    label: `${title} — ${description} (another Worldstreet app)`,
    url: href,
    external: true,
  })),
]

export const DESTINATION_IDS = DESTINATIONS.map((d) => d.id)

function describeDestinations(): string {
  return "Destinations:\n" + DESTINATIONS.map((d) => `- ${d.id}: ${d.label}`).join("\n")
}

function currentStreamId(): string | null {
  const m = window.location.pathname.match(/^\/stream\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function ownUsername(): string | null {
  // The channel link in the sidebar/topbar is rendered from the signed-in
  // user's username; read it rather than threading auth state into a tool.
  const a = document.querySelector<HTMLAnchorElement>('a[data-vivid-own-channel]')
  const m = a?.getAttribute("href")?.match(/^\/c\/([^/?#]+)/)
  return m ? m[1] : null
}

// ── Client tools ────────────────────────────────────────────────────────────

export const navigateToPage = define({
  name: "navigateToPage",
  description:
    "Take the user to a screen on Xtreme or elsewhere in the Worldstreet ecosystem. " +
    "Pass the destination id — NOT a URL path. Ecosystem destinations load a different Worldstreet site, which is expected. " +
    "To open a specific stream use openStream instead.\n" +
    describeDestinations(),
  parameters: buildParameters({
    destination: enumParam("Which screen to open. Must be one of the listed destination ids.", DESTINATION_IDS, true),
  }),
  handler: async ({ destination }: { destination?: string }) => {
    if (typeof window === "undefined") return { error: "Navigation is only available in the browser" }
    const target = DESTINATIONS.find((d) => d.id === destination)
    if (!target) return { error: `Unknown destination "${destination}".`, validDestinations: DESTINATION_IDS }
    let url = target.url
    if (target.needsUsername) {
      const username = ownUsername()
      if (!username) return { error: "Couldn't find your channel — are you signed in?" }
      url = `/c/${username}`
    }
    if (target.external) window.location.assign(url)
    else window.dispatchEvent(new CustomEvent("vivid:navigate", { detail: { path: url } }))
    return { success: true, opened: target.label, leftThisApp: Boolean(target.external) }
  },
  executionContext: "client",
})

export const openStream = define({
  name: "openStream",
  description:
    "Open a specific stream so the user can watch it. Pass the stream id you got from listLiveStreams, findChannel or listFollowing. " +
    "Reply with a word or two, don't narrate.",
  parameters: buildParameters({ streamId: stringParam("The stream's id.", true) }),
  handler: async ({ streamId }: { streamId?: string }) => {
    if (typeof window === "undefined") return { error: "Navigation is only available in the browser" }
    if (!streamId || !/^[A-Za-z0-9_-]{6,64}$/.test(streamId)) return { error: "That doesn't look like a stream id." }
    window.dispatchEvent(new CustomEvent("vivid:navigate", { detail: { path: `/stream/${streamId}` } }))
    return { success: true }
  },
  executionContext: "client",
})

export const getCurrentPageContext = define({
  name: "getCurrentPageContext",
  description:
    "Find out what the user is looking at right now — the page they are on, what is rendered on it, and live on-screen values " +
    "(whether they're live, the stream title, viewer count, whether a dialog is open). " +
    'CALL THIS whenever the user says "this page", "this screen", "here", "what am I looking at", or asks about something visible without naming it. ' +
    "The page changes as they navigate, so never rely on what you were told earlier — check.",
  parameters: buildParameters({}),
  handler: async () => {
    if (typeof window === "undefined") return { error: "Page context is only available in the browser" }
    const path = window.location.pathname
    const info = getPageInfo(path)
    const live = readLiveContext()
    return {
      path,
      page: info.name,
      whatIsOnScreen: info.summary,
      ...(info.actions ? { whatTheUserCanDoHere: info.actions } : {}),
      ...(Object.keys(live).length > 0
        ? { liveOnScreen: live }
        : { note: "No live values published by this page — describe it from whatIsOnScreen." }),
    }
  },
  executionContext: "client",
})

export const sendStreamChat = define({
  name: "sendStreamChat",
  description:
    "Send a chat message, as the user, into the stream they are currently watching. Only works on a stream page. " +
    "Send exactly what they asked you to say; returns what was sent. Slow mode allows one message every 30 seconds.",
  parameters: buildParameters({ text: stringParam("The message to send, 1-500 characters.", true) }),
  handler: async ({ text }: { text?: string }) => {
    if (typeof window === "undefined") return { error: "Chat is only available in the browser" }
    const id = currentStreamId()
    if (!id) return { error: "The user isn't on a stream page." }
    const content = (text ?? "").trim().slice(0, 500)
    if (!content) return { error: "Nothing to send." }
    try {
      await apiFetch(`/api/streams/${id}/chat`, {
        method: "POST",
        body: JSON.stringify({ content, type: "text", platform: "xstream" }),
      })
      return { success: true, sent: content }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) return { error: "Slow mode — wait 30 seconds between messages." }
      if (err instanceof ApiError && err.status === 401) return { error: "The user needs to sign in to chat." }
      return errorOf(err, "Couldn't send the message")
    }
  },
  executionContext: "client",
})

const QUICK_REACTIONS = ["🔥", "🚀", "💎", "🙌", "💰", "📈", "📉", "🐻", "🐂", "😂"]

export const sendReaction = define({
  name: "sendReaction",
  description:
    "Send a quick emoji reaction into the stream the user is watching. Free, instant. Only on a stream page. " +
    "Pick the emoji that matches what they said: fire, rocket, diamond, hands up, money, chart up, chart down, bear, bull, laughing.",
  parameters: buildParameters({ emoji: enumParam("The reaction emoji.", QUICK_REACTIONS, true) }),
  handler: async ({ emoji }: { emoji?: string }) => {
    if (typeof window === "undefined") return { error: "Reactions are only available in the browser" }
    const id = currentStreamId()
    if (!id) return { error: "The user isn't on a stream page." }
    if (!emoji || !QUICK_REACTIONS.includes(emoji)) return { error: "Not one of the quick reactions.", valid: QUICK_REACTIONS }
    try {
      await apiFetch(`/api/streams/${id}/chat`, {
        method: "POST",
        body: JSON.stringify({ content: emoji, type: "reaction", emoji, platform: "xstream" }),
      })
      return { success: true, sent: emoji }
    } catch (err) {
      return errorOf(err, "Couldn't send the reaction")
    }
  },
  executionContext: "client",
})

export const likeStream = define({
  name: "likeStream",
  description: "Like (or unlike) the stream the user is watching. Free and reversible. Only on a stream page. Returns the new like count.",
  parameters: buildParameters({ like: booleanParam("true to like, false to remove the like. Defaults to true.") }),
  handler: async ({ like }: { like?: boolean }) => {
    if (typeof window === "undefined") return { error: "Likes are only available in the browser" }
    const id = currentStreamId()
    if (!id) return { error: "The user isn't on a stream page." }
    try {
      const res = await apiFetch<{ data?: { likes?: number; liked?: boolean } }>(`/api/streams/${id}/like`, {
        method: like === false ? "DELETE" : "POST",
      })
      return { success: true, liked: res?.data?.liked ?? like !== false, likes: res?.data?.likes }
    } catch (err) {
      return errorOf(err, "Couldn't update the like")
    }
  },
  executionContext: "client",
})

const GIFT_IDS = GIFT_CATALOG.map((g) => g.id)

function describeGifts(): string {
  return "Gifts and what they cost:\n" + GIFT_CATALOG.map((g) => `- ${g.id}: ${g.name} ${g.emoji}, ${centsToDollars(g.usdMinor)}`).join("\n")
}

export const sendGift = define({
  name: "sendGift",
  description:
    "Send a paid gift to the streamer the user is watching. This spends REAL MONEY from the user's Worldstreet dollar wallet. " +
    "Strict flow: first call with confirmed=false to get the exact price, then say the gift and price out loud and wait for a clear spoken yes, " +
    "then call again with confirmed=true. Only on a stream page.\n" +
    describeGifts(),
  parameters: buildParameters({
    gift: enumParam("Which gift to send.", GIFT_IDS, true),
    confirmed: booleanParam("false to quote the price; true ONLY after the user has said yes to that exact gift and price.", true),
  }),
  handler: async ({ gift, confirmed }: { gift?: string; confirmed?: boolean }) => {
    if (typeof window === "undefined") return { error: "Gifts are only available in the browser" }
    const id = currentStreamId()
    if (!id) return { error: "The user isn't on a stream page." }
    const def = GIFT_CATALOG.find((g) => g.id === gift)
    if (!def) return { error: `Unknown gift "${gift}".`, validGifts: GIFT_IDS }
    const price = centsToDollars(def.usdMinor)
    if (confirmed !== true) {
      return { needsConfirmation: true, gift: def.name, emoji: def.emoji, price, say: `Ask: send a ${def.name} for ${price}?` }
    }
    try {
      await apiFetch(`/api/streams/${id}/gifts`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amountUsdMinor: def.usdMinor, giftName: def.name, emoji: def.emoji, platform: "xstream" }),
      })
      return { success: true, sent: def.name, price }
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) return { error: `Not enough in the wallet for ${price}.` }
      if (err instanceof ApiError && err.status === 503) return { error: "The wallet is unavailable right now." }
      return errorOf(err, "Couldn't send the gift")
    }
  },
  executionContext: "client",
})

export const studioControl = define({
  name: "studioControl",
  description:
    "Press a control in the Studio for the user: mute_mic, unmute_mic, camera_on, camera_off, start_screen_share, stop_screen_share, go_live, end_stream. " +
    "Only works while the user is on the studio page — if they aren't, take them there first with navigateToPage(studio). " +
    "go_live starts broadcasting with the title and category already filled in on the page, and end_stream ends a live broadcast for everyone watching — " +
    "both are irreversible: say what will happen, wait for a clear spoken yes, then call with confirmed=true. The other actions need no confirmation.",
  parameters: buildParameters({
    action: enumParam("The control to press.", STUDIO_ACTIONS, true),
    confirmed: booleanParam("Required true for go_live and end_stream, after the user has said yes."),
  }),
  handler: async ({ action, confirmed }: { action?: string; confirmed?: boolean }) => {
    if (typeof window === "undefined") return { error: "Studio controls are only available in the browser" }
    if (!action || !STUDIO_ACTIONS.includes(action as StudioAction)) return { error: `Unknown action "${action}".`, validActions: STUDIO_ACTIONS }
    const bridge = getStudioBridge()
    if (!bridge) return { error: "The user isn't in the studio. Use navigateToPage(studio) first." }
    if ((action === "go_live" || action === "end_stream") && confirmed !== true) {
      return {
        needsConfirmation: true,
        action,
        say: action === "go_live" ? "Ask: start the stream now?" : "Ask: end the stream for everyone watching?",
      }
    }
    try {
      return await bridge(action as StudioAction)
    } catch (err) {
      return errorOf(err, "The studio control failed")
    }
  },
  executionContext: "client",
})

// ── Server tool stubs (real bodies in lib/vivid-functions.server.ts) ────────

export const listLiveStreams = serverStub(
  "listLiveStreams",
  "Who is live on Xtreme right now. Returns up to 12 live streams with id, title, streamer, category and viewer count, most watched first. " +
    "Optionally filter by category (e.g. 'Just Chatting', 'Forex', 'Crypto') or a search word. " +
    "Call this for 'who's live', 'what's on', 'anything good', 'show me trading streams'.",
  buildParameters({
    category: stringParam("Filter to one category name."),
    search: stringParam("Search word matched against titles and streamers."),
    sort: enumParam("viewers (default), trending, or recent.", ["viewers", "trending", "recent"]),
  }),
)

export const findChannel = serverStub(
  "findChannel",
  "Find a channel (streamer) by name or username. Returns matches with username, display name, follower count, whether they're live and their live stream's id and title. " +
    "Use it before followChannel or openStream when the user names a person.",
  buildParameters({ query: stringParam("Name or username to search for.", true) }),
)

export const followChannel = serverStub(
  "followChannel",
  "Follow (become an ally of) or unfollow a channel for the user. Reversible, no confirmation needed. Pass the exact username from findChannel.",
  buildParameters({
    username: stringParam("The channel's username.", true),
    follow: booleanParam("true to follow, false to unfollow. Defaults to true."),
  }),
)

export const listFollowing = serverStub(
  "listFollowing",
  "The channels the user follows (their allies), live ones first with their stream id, title and viewers. Call for 'is anyone I follow live', 'who do I follow'.",
  buildParameters({}),
)

export const updateStreamInfo = serverStub(
  "updateStreamInfo",
  "Change the title and/or category of the user's OWN stream while it is live. Reversible. Returns the updated stream. Errors if they aren't live.",
  buildParameters({
    title: stringParam("New title, up to 100 characters."),
    category: stringParam("New category name, e.g. 'Just Chatting', 'Forex', 'Crypto'."),
  }),
)

export const getLiveStats = serverStub(
  "getLiveStats",
  "Live stats for the user's OWN current stream: title, category, current viewers, how long they've been live, and top supporters so far. Says so if they aren't live.",
  buildParameters({}),
)

export const getWalletBalance = serverStub(
  "getWalletBalance",
  "The user's Xtreme wallet: available and locked dollar balance. Call it every time they ask about their balance — never reuse an earlier figure.",
  buildParameters({}),
)

export const getCreatorEarnings = serverStub(
  "getCreatorEarnings",
  "The user's creator earnings: gift earnings balance, total gifts received and sent, and headline stats (followers, peak viewers, hours streamed, streams). Read-only.",
  buildParameters({}),
)

export const getPoints = serverStub(
  "getPoints",
  "The user's points: balance, watch streak, recent ledger, and the rules for redeeming points to the wallet (1,000 points = $1). Read-only — redeeming is done on the Rewards page.",
  buildParameters({}),
)

export const getNotifications = serverStub(
  "getNotifications",
  "The user's recent notifications (who went live, new allies, gifts) and the unread count.",
  buildParameters({ limit: numberParam("How many, up to 20. Default 10.") }),
)

export const xtremeFunctions: VoiceFunctionConfig[] = [
  navigateToPage,
  openStream,
  getCurrentPageContext,
  sendStreamChat,
  sendReaction,
  likeStream,
  sendGift,
  studioControl,
  listLiveStreams,
  findChannel,
  followChannel,
  listFollowing,
  updateStreamInfo,
  getLiveStats,
  getWalletBalance,
  getCreatorEarnings,
  getPoints,
  getNotifications,
]
