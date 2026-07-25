/**
 * Stream categories, their badge styling, and small display helpers.
 *
 * Replaces the old `lib/mock-data.ts`, which mixed these real constants in
 * with fabricated users, streams, chat messages and past-stream earnings.
 * Only the constants were ever imported; the mock records are gone.
 *
 * CATEGORIES must stay in step with `CATEGORIES` in `@xtreme/contracts`, which
 * is what the API validates against — a category here that the API rejects
 * would surface as a validation error when going live.
 */

export type Category =
  | "Bitcoin Trading"
  | "Altcoins & DeFi"
  | "NFTs & Web3"
  | "Market Analysis"
  | "Crypto Education"
  | "General / Just Chatting";

export const CATEGORIES: Category[] = [
  "Bitcoin Trading",
  "Altcoins & DeFi",
  "NFTs & Web3",
  "Market Analysis",
  "Crypto Education",
  "General / Just Chatting",
];

export const CATEGORY_COLORS: Record<Category, string> = {
  "Bitcoin Trading": "bg-orange-500/15 text-orange-400 border-orange-500/20",
  "Altcoins & DeFi": "bg-purple-500/15 text-purple-400 border-purple-500/20",
  "NFTs & Web3": "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  "Market Analysis": "bg-green-500/15 text-green-400 border-green-500/20",
  "Crypto Education": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "General / Just Chatting": "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

/** The streamer fields a stream card actually renders. */
export type StreamCardStreamer = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  verified?: boolean;
};

export type Stream = {
  id: string;
  title: string;
  category: Category;
  streamer: StreamCardStreamer;
  /** Current concurrent viewers — 0 once a stream has ended. */
  viewers: number;
  thumbnail: string;
  isLive: boolean;
  startedAt: string;
  duration: string;
  tags: string[];
};

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
