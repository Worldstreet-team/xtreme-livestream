// ──────────────────────────────────────
// Types
// ──────────────────────────────────────

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

export type User = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followers: number;
  following: number;
  totalViews: number;
  isLive: boolean;
  joinedAt: string;
};

export type Stream = {
  id: string;
  title: string;
  category: Category;
  streamer: User;
  viewers: number;
  thumbnail: string;
  isLive: boolean;
  startedAt: string;
  duration: string;
  tags: string[];
};

export type ChatMessage = {
  id: string;
  user: { username: string; avatar: string; isMod?: boolean };
  content: string;
  type: "text" | "tip" | "reaction";
  tipAmount?: string;
  tipCurrency?: string;
  emoji?: string;
  timestamp: string;
};

export type PastStream = {
  id: string;
  title: string;
  category: Category;
  thumbnail: string;
  viewers: number;
  peakViewers: number;
  duration: string;
  date: string;
  earnings: string;
};

// ──────────────────────────────────────
// Mock Users
// ──────────────────────────────────────

export const CURRENT_USER: User = {
  id: "me",
  username: "you",
  displayName: "Your Channel",
  avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=You",
  bio: "Crypto trader & streamer on Xtreme Worldstreet",
  followers: 1240,
  following: 89,
  totalViews: 54200,
  isLive: false,
  joinedAt: "2025-06-15",
};

export const MOCK_USERS: User[] = [
  {
    id: "u1",
    username: "CryptoKing",
    displayName: "CryptoKing",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=CryptoKing",
    bio: "Full-time BTC trader. 8 years in the market. Sharing setups live daily.",
    followers: 245000,
    following: 34,
    totalViews: 12800000,
    isLive: true,
    joinedAt: "2024-01-10",
  },
  {
    id: "u2",
    username: "DeFiDegen",
    displayName: "DeFi Degen",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=DeFiDegen",
    bio: "Yield farmer, liquidity provider, protocol degen. Not financial advice.",
    followers: 189000,
    following: 120,
    totalViews: 9200000,
    isLive: true,
    joinedAt: "2024-03-22",
  },
  {
    id: "u3",
    username: "NFTWhale",
    displayName: "NFT Whale",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=NFTWhale",
    bio: "Top NFT collector & flipper. Tracking blue chips and mints.",
    followers: 156000,
    following: 67,
    totalViews: 7500000,
    isLive: true,
    joinedAt: "2024-02-05",
  },
  {
    id: "u4",
    username: "ETHMaxi",
    displayName: "ETH Maxi",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=ETHMaxi",
    bio: "Ethereum bull. Layer 2 enthusiast. Validator since The Merge.",
    followers: 134000,
    following: 45,
    totalViews: 6100000,
    isLive: false,
    joinedAt: "2024-04-18",
  },
  {
    id: "u5",
    username: "AltHunter",
    displayName: "Alt Hunter",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=AltHunter",
    bio: "Finding the next 100x. Micro-cap analyst & on-chain sleuth.",
    followers: 112000,
    following: 210,
    totalViews: 5400000,
    isLive: true,
    joinedAt: "2024-05-30",
  },
  {
    id: "u6",
    username: "ChainAnalyst",
    displayName: "Chain Analyst",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=ChainAnalyst",
    bio: "On-chain data nerd. Whale watching & smart money tracking.",
    followers: 98000,
    following: 55,
    totalViews: 4800000,
    isLive: false,
    joinedAt: "2024-07-12",
  },
  {
    id: "u7",
    username: "MevBot_",
    displayName: "MEV Bot",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=MevBot",
    bio: "MEV researcher. Building bots, sharing alpha on extraction strategies.",
    followers: 87000,
    following: 15,
    totalViews: 3900000,
    isLive: true,
    joinedAt: "2024-08-01",
  },
  {
    id: "u8",
    username: "YieldFarmer",
    displayName: "Yield Farmer",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=YieldFarmer",
    bio: "Passive income maximizer. Staking, LP, vaults — covering it all.",
    followers: 76000,
    following: 92,
    totalViews: 3200000,
    isLive: false,
    joinedAt: "2024-09-14",
  },
  {
    id: "u9",
    username: "TaxGuru",
    displayName: "Tax Guru",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=TaxGuru",
    bio: "CPA turned crypto educator. Making taxes less painful.",
    followers: 63000,
    following: 28,
    totalViews: 2800000,
    isLive: false,
    joinedAt: "2024-10-20",
  },
  {
    id: "u10",
    username: "SolanaSlinger",
    displayName: "Solana Slinger",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=SolanaSlinger",
    bio: "SPL degen. Fast chains, fast trades. Solana ecosystem deep dives.",
    followers: 52000,
    following: 143,
    totalViews: 2100000,
    isLive: true,
    joinedAt: "2025-01-05",
  },
  {
    id: "u11",
    username: "MacroMaven",
    displayName: "Macro Maven",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=MacroMaven",
    bio: "Connecting macro economics to crypto markets. CPI, FOMC, DXY.",
    followers: 44000,
    following: 31,
    totalViews: 1700000,
    isLive: true,
    joinedAt: "2025-02-18",
  },
  {
    id: "u12",
    username: "AirdropAlpha",
    displayName: "Airdrop Alpha",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=AirdropAlpha",
    bio: "Professional airdrop farmer. Tracking every opportunity.",
    followers: 38000,
    following: 200,
    totalViews: 1400000,
    isLive: false,
    joinedAt: "2025-03-10",
  },
];

// ──────────────────────────────────────
// Mock Streams
// ──────────────────────────────────────

const THUMBNAILS = [
  "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1639762681057-408e52192e55?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1644143379190-08a5f055de1d?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1642104704074-907c0698b98d?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1622630998477-20aa696ecb05?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1621761191319-c6fb62004040?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?q=80&w=800&auto=format&fit=crop",
];

export const MOCK_STREAMS: Stream[] = [
  {
    id: "s1",
    title: "BTC Analysis: Bull Run Incoming? Live Chart Breakdown",
    category: "Bitcoin Trading",
    streamer: MOCK_USERS[0],
    viewers: 12400,
    thumbnail: THUMBNAILS[0],
    isLive: true,
    startedAt: "2026-02-07T08:00:00Z",
    duration: "3h 24m",
    tags: ["bitcoin", "technical-analysis", "live-trading"],
  },
  {
    id: "s2",
    title: "Solana DeFi Deep Dive — Finding Hidden Yields",
    category: "Altcoins & DeFi",
    streamer: MOCK_USERS[1],
    viewers: 8100,
    thumbnail: THUMBNAILS[1],
    isLive: true,
    startedAt: "2026-02-07T09:30:00Z",
    duration: "1h 54m",
    tags: ["solana", "defi", "yield-farming"],
  },
  {
    id: "s3",
    title: "NFT Minting Strategy 2026 — What's Actually Worth It",
    category: "NFTs & Web3",
    streamer: MOCK_USERS[2],
    viewers: 5700,
    thumbnail: THUMBNAILS[2],
    isLive: true,
    startedAt: "2026-02-07T10:00:00Z",
    duration: "1h 12m",
    tags: ["nfts", "minting", "alpha"],
  },
  {
    id: "s4",
    title: "Ethereum Merge Update & Restaking Meta",
    category: "Altcoins & DeFi",
    streamer: MOCK_USERS[3],
    viewers: 3900,
    thumbnail: THUMBNAILS[3],
    isLive: false,
    startedAt: "2026-02-06T14:00:00Z",
    duration: "2h 45m",
    tags: ["ethereum", "restaking", "eigenlayer"],
  },
  {
    id: "s5",
    title: "Altcoin Gems: 100x Potential Picks for Q1 2026",
    category: "Altcoins & DeFi",
    streamer: MOCK_USERS[4],
    viewers: 6200,
    thumbnail: THUMBNAILS[4],
    isLive: true,
    startedAt: "2026-02-07T07:15:00Z",
    duration: "4h 09m",
    tags: ["altcoins", "micro-cap", "100x"],
  },
  {
    id: "s6",
    title: "Crypto Tax Strategies for Traders in 2026",
    category: "Crypto Education",
    streamer: MOCK_USERS[8],
    viewers: 2300,
    thumbnail: THUMBNAILS[5],
    isLive: false,
    startedAt: "2026-02-05T16:00:00Z",
    duration: "1h 30m",
    tags: ["taxes", "education", "compliance"],
  },
  {
    id: "s7",
    title: "MEV Extraction Strategies — Live Bot Monitoring",
    category: "Market Analysis",
    streamer: MOCK_USERS[6],
    viewers: 4100,
    thumbnail: THUMBNAILS[6],
    isLive: true,
    startedAt: "2026-02-07T06:00:00Z",
    duration: "5h 30m",
    tags: ["mev", "bots", "arbitrage"],
  },
  {
    id: "s8",
    title: "On-Chain Whale Tracking — Who's Accumulating?",
    category: "Market Analysis",
    streamer: MOCK_USERS[5],
    viewers: 3400,
    thumbnail: THUMBNAILS[7],
    isLive: false,
    startedAt: "2026-02-06T20:00:00Z",
    duration: "2h 15m",
    tags: ["on-chain", "whales", "analytics"],
  },
  {
    id: "s9",
    title: "Solana Memecoin Season — Live Snipes & Calls",
    category: "Altcoins & DeFi",
    streamer: MOCK_USERS[9],
    viewers: 7800,
    thumbnail: THUMBNAILS[0],
    isLive: true,
    startedAt: "2026-02-07T11:00:00Z",
    duration: "0h 42m",
    tags: ["solana", "memecoins", "degen"],
  },
  {
    id: "s10",
    title: "FOMC Reaction Stream — What It Means for Crypto",
    category: "Market Analysis",
    streamer: MOCK_USERS[10],
    viewers: 5100,
    thumbnail: THUMBNAILS[1],
    isLive: true,
    startedAt: "2026-02-07T10:30:00Z",
    duration: "1h 04m",
    tags: ["macro", "fomc", "fed"],
  },
  {
    id: "s11",
    title: "Airdrop Season Guide — Farming the Big Ones",
    category: "Crypto Education",
    streamer: MOCK_USERS[11],
    viewers: 2900,
    thumbnail: THUMBNAILS[2],
    isLive: false,
    startedAt: "2026-02-06T12:00:00Z",
    duration: "1h 50m",
    tags: ["airdrops", "farming", "guide"],
  },
  {
    id: "s12",
    title: "Yield Optimization Masterclass — Stables to 20% APY",
    category: "Altcoins & DeFi",
    streamer: MOCK_USERS[7],
    viewers: 1800,
    thumbnail: THUMBNAILS[3],
    isLive: false,
    startedAt: "2026-02-05T18:00:00Z",
    duration: "2h 10m",
    tags: ["yield", "stablecoins", "defi"],
  },
];

// ──────────────────────────────────────
// Mock Chat Messages
// ──────────────────────────────────────

export const MOCK_CHAT_MESSAGES: ChatMessage[] = [
  { id: "c1", user: { username: "degen_dave", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=dave" }, content: "LFG!! BTC looking bullish 🚀", type: "text", timestamp: "12:01" },
  { id: "c2", user: { username: "whale_watcher", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=whale", isMod: true }, content: "Remember no financial advice in chat", type: "text", timestamp: "12:01" },
  { id: "c3", user: { username: "moon_boy", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=moon" }, content: "", type: "reaction", emoji: "🔥", timestamp: "12:02" },
  { id: "c4", user: { username: "sol_surfer", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=sol" }, content: "Great analysis on that support level", type: "text", timestamp: "12:02" },
  { id: "c5", user: { username: "crypto_carl", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=carl" }, content: "Sent a tip!", type: "tip", tipAmount: "0.005", tipCurrency: "ETH", timestamp: "12:03" },
  { id: "c6", user: { username: "alpha_anna", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=anna" }, content: "Can you zoom into the 4h chart?", type: "text", timestamp: "12:03" },
  { id: "c7", user: { username: "bag_holder", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=bag" }, content: "", type: "reaction", emoji: "🚀", timestamp: "12:04" },
  { id: "c8", user: { username: "defi_dan", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=dan" }, content: "What's your stop loss on this trade?", type: "text", timestamp: "12:04" },
  { id: "c9", user: { username: "nft_nina", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=nina" }, content: "Tipped!", type: "tip", tipAmount: "25", tipCurrency: "USDC", timestamp: "12:05" },
  { id: "c10", user: { username: "satoshi_stan", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=stan" }, content: "WAGMI 💎🙌", type: "text", timestamp: "12:05" },
  { id: "c11", user: { username: "pump_pete", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=pete" }, content: "", type: "reaction", emoji: "💎", timestamp: "12:06" },
  { id: "c12", user: { username: "shill_master", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=shill" }, content: "This is the best stream on the platform", type: "text", timestamp: "12:06" },
  { id: "c13", user: { username: "gas_tracker", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=gas", isMod: true }, content: "Gas fees dropping, good time to move", type: "text", timestamp: "12:07" },
  { id: "c14", user: { username: "rekt_randy", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=randy" }, content: "Just got liquidated... F", type: "text", timestamp: "12:07" },
  { id: "c15", user: { username: "diamond_hands", avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=diamond" }, content: "Donated!", type: "tip", tipAmount: "0.1", tipCurrency: "SOL", timestamp: "12:08" },
];

// ──────────────────────────────────────
// Mock Past Streams (for dashboard)
// ──────────────────────────────────────

export const MOCK_PAST_STREAMS: PastStream[] = [
  { id: "ps1", title: "Morning BTC Scalping Session", category: "Bitcoin Trading", thumbnail: THUMBNAILS[0], viewers: 3200, peakViewers: 4800, duration: "2h 15m", date: "2026-02-06", earnings: "$124.50" },
  { id: "ps2", title: "Altcoin Portfolio Review & Rebalance", category: "Altcoins & DeFi", thumbnail: THUMBNAILS[1], viewers: 1800, peakViewers: 2400, duration: "1h 45m", date: "2026-02-05", earnings: "$67.20" },
  { id: "ps3", title: "NFT Market Weekly Recap", category: "NFTs & Web3", thumbnail: THUMBNAILS[2], viewers: 2100, peakViewers: 3100, duration: "1h 30m", date: "2026-02-04", earnings: "$89.00" },
  { id: "ps4", title: "Crypto Tax Q&A Session", category: "Crypto Education", thumbnail: THUMBNAILS[5], viewers: 950, peakViewers: 1200, duration: "1h 10m", date: "2026-02-03", earnings: "$34.80" },
  { id: "ps5", title: "DeFi Yield Farming Strategy", category: "Altcoins & DeFi", thumbnail: THUMBNAILS[3], viewers: 2800, peakViewers: 3600, duration: "2h 30m", date: "2026-02-02", earnings: "$142.00" },
  { id: "ps6", title: "Weekend AMA — Ask Me Anything", category: "General / Just Chatting", thumbnail: THUMBNAILS[4], viewers: 1500, peakViewers: 2200, duration: "3h 00m", date: "2026-02-01", earnings: "$55.40" },
];

// ──────────────────────────────────────
// Helpers
// ──────────────────────────────────────

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
