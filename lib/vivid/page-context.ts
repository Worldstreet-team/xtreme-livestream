// What the user is currently looking at, for Vivid.
//
// Two halves, same design as the web app's lib/vivid-page-context.ts:
//
// 1. PAGE_CONTEXT — a static description of each route: what's on screen and
//    what can be done there. Enough for "where am I?" / "what is this page?".
//
// 2. A live registry — pages publish the state they're actually rendering
//    (live or not, title, viewers, chat placement, open modal) so Vivid can
//    answer "how many are watching?" with real values.
//
// The session prompt is built ONCE when the voice session starts, so anything
// injected there goes stale the moment the user navigates. That's why this is
// read through a tool (getCurrentPageContext) — evaluated when asked.

export type PageInfo = {
  name: string
  /** What's rendered on this page. */
  summary: string
  /** What the user can do here — helps Vivid answer follow-ups. */
  actions?: string
}

export const PAGE_CONTEXT: Record<string, PageInfo> = {
  "/explore": {
    name: "Home",
    summary:
      "Xtreme's home page: a featured stream up top, then rows of live streams — trending, followed channels that are live, " +
      "per-category shelves and channel picks. Category chips filter the live grid. A search box finds channels.",
    actions: "Open a stream, filter by category, search for a channel, follow a channel from its card.",
  },
  "/browse": {
    name: "Browse",
    summary:
      "The category directory. Every category with something live, plus filters: category, tag, sort (viewers, recent, trending) " +
      "and live / upcoming / ended.",
    actions: "Pick a category, change the sort, open a stream.",
  },
  "/feed": {
    name: "Live feed",
    summary: "A full-screen vertical swipe feed of live streams, previews muted. One stream at a time.",
    actions: "Swipe to the next or previous stream, open it, share it, jump to the channel.",
  },
  "/following": {
    name: "Following",
    summary: "The channels the user is allied with (follows): who is live now, then everyone else.",
    actions: "Open a live stream, open a channel page.",
  },
  "/studio": {
    name: "Studio",
    summary:
      "Where the user goes live. Before going live: title, category, up to six tags, a thumbnail, and the source — camera, screen share, or an external encoder (OBS) with a stream key. " +
      "While live: the preview, mic and camera toggles, screen share, viewer count and elapsed time, chat, stage guest requests, co-live invites, battles and games, and the End stream button.",
    actions:
      "Set up and start a stream, mute or unmute the mic, turn the camera on or off, share the screen, approve stage guests, invite a co-host, end the stream.",
  },
  "/stream": {
    name: "Watching a stream",
    summary:
      "A live stream: the video player with mute, fullscreen, picture-in-picture and theater mode, the streamer's name and title, " +
      "a follow (ally) button, like button, live chat with quick reactions and a gift keyboard, top supporters, and a request-to-join-stage button.",
    actions: "Chat, react, like, send a gift, follow the streamer, request to join the stage, report the stream.",
  },
  "/c": {
    name: "Channel page",
    summary: "A streamer's channel: avatar, bio, follower count, a Watch live button when they're on air, and their past streams.",
    actions: "Follow or unfollow, watch the live stream, open a past stream.",
  },
  "/wallet": {
    name: "Wallet",
    summary:
      "The user's money on Xtreme: the dollar balance (available and locked), gift earnings, recent gift transactions, points payouts, and the points ledger, in tabs.",
    actions: "Read balances and history. Nothing is sent from here.",
  },
  "/rewards": {
    name: "Rewards",
    summary:
      "Points: the balance, watch streak, and a redeem control that turns points into wallet dollars in 1,000-point steps (1,000 points = $1), with the payout rules and history.",
    actions: "Redeem points to the wallet.",
  },
  "/settings": {
    name: "Settings",
    summary: "Profile (display name, username, bio, avatar) and stream settings (auto record, slow mode, followers-only chat, profanity filter).",
    actions: "Edit and save the profile or stream settings.",
  },
  "/dashboard": {
    name: "Creator dashboard",
    summary: "Creator stats: peak viewers, followers, hours streamed, streams, average viewers, gift earnings, the last ten streams, and a seven-day views chart.",
    actions: "Read stats.",
  },
  "/welcome": {
    name: "Welcome",
    summary: "A first-run picker for favourite categories and channels.",
  },
  "/": { name: "Landing page", summary: "Xtreme's public landing page." },
  "/sign-in": { name: "Sign in", summary: "The sign-in screen." },
  "/sign-up": { name: "Sign up", summary: "The account creation screen." },
}

export function getPageInfo(pathname: string): PageInfo {
  if (PAGE_CONTEXT[pathname]) return PAGE_CONTEXT[pathname]
  // Longest matching prefix, so /stream/abc and /c/name inherit their parent.
  const prefix = Object.keys(PAGE_CONTEXT)
    .filter((route) => route !== "/" && pathname.startsWith(route))
    .sort((a, b) => b.length - a.length)[0]
  if (prefix) return PAGE_CONTEXT[prefix]
  return { name: "Xtreme", summary: `The page at ${pathname}.` }
}

// ── Live state registry ─────────────────────────────────────────────────────
// Pages register a getter; the tool reads them all when asked. Getters are
// called at read time so the values are always current — never cached.

type Snapshot = Record<string, unknown>

const liveSources = new Map<string, () => Snapshot | null>()

export function registerVividContext(key: string, getter: () => Snapshot | null): () => void {
  liveSources.set(key, getter)
  return () => {
    // Only remove if this exact getter is still registered — guards against a
    // remount registering before the old instance's cleanup runs.
    if (liveSources.get(key) === getter) liveSources.delete(key)
  }
}

export function readLiveContext(): Snapshot {
  const out: Snapshot = {}
  for (const [key, getter] of liveSources) {
    try {
      const value = getter()
      if (value && Object.keys(value).length > 0) out[key] = value
    } catch {
      // A broken publisher shouldn't take down the whole context read.
    }
  }
  return out
}

// ── Studio bridge ───────────────────────────────────────────────────────────
// The studio's mic, camera, screen share, go-live and end-stream are LiveKit
// calls on the page's own state, so a tool can't reach them by HTTP. The
// studio page registers a handler here while mounted; studioControl calls it.

export type StudioAction =
  | "mute_mic"
  | "unmute_mic"
  | "camera_on"
  | "camera_off"
  | "start_screen_share"
  | "stop_screen_share"
  | "go_live"
  | "end_stream"

export const STUDIO_ACTIONS: StudioAction[] = [
  "mute_mic",
  "unmute_mic",
  "camera_on",
  "camera_off",
  "start_screen_share",
  "stop_screen_share",
  "go_live",
  "end_stream",
]

export type StudioBridge = (action: StudioAction) => Promise<Record<string, unknown>>

let studioBridge: StudioBridge | null = null

export function registerStudioBridge(bridge: StudioBridge): () => void {
  studioBridge = bridge
  return () => {
    if (studioBridge === bridge) studioBridge = null
  }
}

export function getStudioBridge(): StudioBridge | null {
  return studioBridge
}
