import type { Stream } from "@/lib/categories";
import type { BattleView } from "@/lib/battles";
import type { CategorySummary } from "@/lib/discovery";
import type { PeltRow } from "@/components/xtream";

/**
 * Example content for the reference. Every name, number and title here is
 * made up and marked as such on the page; the pictures are stills from
 * Xtream's own promo clips (public/promo), standing in for real streams.
 */

/** For CSS backgrounds — root-relative. */
export const STAGE = {
  cover: "/images/stage/cover.webp",
  dj: "/images/stage/dj.webp",
  film: "/images/stage/film.webp",
  deck: "/images/stage/deck.webp",
  group: "/images/stage/group.webp",
  streamer: "/images/stage/streamer.webp",
  performer: "/images/stage/p-performer.webp",
  rooftop: "/images/stage/p-group.webp",
  desk: "/images/stage/p-streamer.webp",
} as const;

/**
 * For StreamArt, which sends root-relative paths to the API host: a
 * document-relative path resolves against /design-system to the same file.
 */
const thumb = (name: string) => `images/stage/${name}.webp`;

const STARTED = "2026-09-23T17:00:00.000Z";

export const SAMPLE_STREAMS: Stream[] = [
  {
    id: "ds-dj",
    title: "Friday night set — deck to deck",
    category: "Music",
    streamer: { id: "ds-u1", username: "djlethal", displayName: "DJ Lethal", avatar: "", isLive: true },
    liveGuests: [],
    viewers: 12480,
    thumbnailUrl: thumb("dj"),
    isLive: true,
    startedAt: STARTED,
    duration: "",
    tags: ["house", "afrobeats"],
  },
  {
    id: "ds-roof",
    title: "Golden hour on the roof",
    category: "IRL",
    streamer: { id: "ds-u2", username: "adaokafor", displayName: "Ada Okafor", avatar: "", isLive: true, verified: true },
    liveGuests: [{ username: "zara", avatar: "" }],
    viewers: 8412,
    thumbnailUrl: thumb("group"),
    isLive: true,
    startedAt: STARTED,
    duration: "",
    tags: ["rooftop", "lagos"],
  },
  {
    id: "ds-desk",
    title: "My first $10K month — ask me anything",
    category: "Just Chatting",
    streamer: { id: "ds-u3", username: "mirachen", displayName: "Mira Chen", avatar: "", isLive: true },
    liveGuests: [],
    viewers: 2960,
    thumbnailUrl: thumb("streamer"),
    isLive: true,
    startedAt: STARTED,
    duration: "",
    tags: [],
  },
  {
    id: "ds-pier",
    title: "Skate jam at the pier",
    category: "IRL",
    streamer: { id: "ds-u4", username: "rolo", displayName: "Rolo", avatar: "", isLive: false },
    liveGuests: [],
    viewers: 0,
    peakViewers: 3120,
    thumbnailUrl: thumb("film"),
    isLive: false,
    startedAt: STARTED,
    duration: "1:42:08",
    tags: [],
  },
];

export const SAMPLE_CATEGORIES: CategorySummary[] = [
  { category: "Music", live: 12, viewers: 48210, cover: null },
  { category: "Just Chatting", live: 31, viewers: 102400, cover: null },
];

export const SAMPLE_RINGS = [
  { id: "r1", username: "adaokafor", displayName: "Ada Okafor", avatar: "", isLive: true, href: "#", viewers: 8412 },
  { id: "r2", username: "mirachen", displayName: "Mira Chen", avatar: "", isLive: true, href: "#", viewers: 2960 },
  { id: "r3", username: "djlethal", displayName: "DJ Lethal", avatar: "", isLive: true, href: "#", viewers: 12480 },
  { id: "r4", username: "kenzo", displayName: "Kenzo Vale", avatar: "", isLive: false, href: "#" },
  { id: "r5", username: "rolo", displayName: "Rolo", avatar: "", isLive: false, href: "#" },
  { id: "r6", username: "nneka", displayName: "Nneka", avatar: "", isLive: false, href: "#" },
];

export const SAMPLE_PELT: PeltRow[] = [
  { name: "Mira Chen", cents: 4_821_000 },
  { name: "Kenzo Vale", cents: 4_190_000 },
  { name: "Ada Okafor", cents: 2_948_000 },
  { name: "DJ Lethal", cents: 1_805_000 },
];

export type BattleMoment = "live" | "closing" | "final";

/**
 * A battle at a given moment, clocked from `now` so the countdown reads
 * right. Built on the client only (the clock would differ between server
 * and browser otherwise).
 */
export function sampleBattle(moment: BattleMoment, now: number): BattleView {
  const host = { userId: "h", username: "kenzo", displayName: "Kenzo", avatar: "", streamId: "ds-dj", usdMinor: 1_248_000 };
  const challenger = { userId: "c", username: "zara", displayName: "Zara", avatar: "", streamId: "ds-roof", usdMinor: 763_000 };
  const secondsLeft = moment === "closing" ? 24 : moment === "live" ? 102 : 0;
  return {
    id: "ds-battle",
    status: moment === "final" ? "ended" : "live",
    scheduledAt: null,
    startsAt: new Date(now - 198_000).toISOString(),
    endsAt: new Date(now + secondsLeft * 1000).toISOString(),
    durationSec: 300,
    multiplierWindowSec: 30,
    multiplier: 2,
    host,
    challenger: moment === "closing" ? { ...challenger, usdMinor: 1_102_000 } : challenger,
    winnerId: moment === "final" ? "h" : null,
    bonusUsdMinor: moment === "final" ? 50_000 : 0,
    overtimeUsed: false,
    endedReason: moment === "final" ? "time" : null,
  };
}
