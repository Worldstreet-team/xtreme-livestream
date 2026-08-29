/**
 * Stream topics and small display helpers.
 *
 * The taxonomy mirrors WorldStreet Social's 100-category content taxonomy
 * (worldstreetsocialmedia-client/src/data/categories.ts) grouped by the same
 * 14 verticals, plus a "General" group for the streaming staples the social
 * feed doesn't need. Labels match the socials app EXACTLY — streams relay
 * into that platform's feed, and its classifier keys on these names.
 *
 * The API validates category as a free string (see @xtreme/contracts), so
 * old streams with retired labels still render; this list is what the studio
 * offers and what Explore falls back to when nothing is live.
 */

export type Category = string;

export interface CategoryGroup {
  label: string;
  topics: string[];
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    label: "General",
    topics: ["Just Chatting", "IRL"],
  },
  {
    label: "Markets & Trading",
    topics: [
      "Stocks & Equities",
      "Crypto Markets",
      "Forex & Currencies",
      "Commodities",
      "Options & Derivatives",
      "Indices & ETFs",
      "Bonds & Rates",
      "Charts & Technical Analysis",
      "IPOs & Listings",
    ],
  },
  {
    label: "Crypto & Web3",
    topics: [
      "DeFi",
      "NFTs & Collectibles",
      "Blockchain & Protocols",
      "Memecoins & Degen",
    ],
  },
  {
    label: "Business & Money",
    topics: [
      "Personal Finance",
      "Real Estate & Property",
      "Startups & VC",
      "Entrepreneurship",
      "Careers & Jobs",
      "Economy & Macro",
      "Fintech & Banking",
      "Tax & Regulation",
      "Side Hustles & Freelance",
    ],
  },
  {
    label: "Technology",
    topics: [
      "AI & Machine Learning",
      "Software & Coding",
      "Gadgets & Consumer Tech",
      "Cybersecurity & Safety",
      "Space & Aerospace",
      "Science & Research",
      "Robotics & Hardware",
      "Energy & Climate Tech",
    ],
  },
  {
    label: "News & Society",
    topics: [
      "World News",
      "Politics & Policy",
      "Climate & Environment",
      "Social Impact & Giving",
      "Law & Justice",
      "Faith & Spirituality",
    ],
  },
  {
    label: "Sports",
    topics: [
      "Football (Soccer)",
      "Basketball",
      "American Football",
      "Cricket",
      "Tennis",
      "Motorsport & F1",
      "Boxing & MMA",
      "Athletics & Olympics",
      "Golf",
      "Baseball",
      "Betting & Fantasy",
    ],
  },
  {
    label: "Gaming",
    topics: ["Video Games", "Mobile Gaming", "Esports", "Chess & Tabletop"],
  },
  {
    label: "Entertainment",
    topics: [
      "Movies & TV",
      "Anime & Manga",
      "Celebrity & Pop Culture",
      "Comedy & Memes",
      "Podcasts & Talk",
      "Books & Reading",
    ],
  },
  {
    label: "Music & Audio",
    topics: [
      "Afrobeats & Amapiano",
      "Hip-Hop & Rap",
      "Pop & Charts",
      "Rock & Metal",
      "Electronic & Dance",
      "Latin & Reggaeton",
      "K-Pop & J-Pop",
      "R&B, Soul & Jazz",
      "Gospel & Worship",
      "Production & DJ",
    ],
  },
  {
    label: "Lifestyle",
    topics: [
      "Fashion & Style",
      "Beauty & Skincare",
      "Food & Cooking",
      "Travel & Adventure",
      "Home & Interiors",
      "Cars & Automotive",
      "Pets & Animals",
      "Family & Parenting",
      "Relationships & Dating",
    ],
  },
  {
    label: "Health & Wellness",
    topics: [
      "Fitness & Training",
      "Nutrition & Diet",
      "Mental Health",
      "Health & Medicine",
      "Mindfulness & Recovery",
    ],
  },
  {
    label: "Arts & Creative",
    topics: [
      "Visual Art & Illustration",
      "Photography",
      "Design & UX",
      "Architecture & Cities",
      "Filmmaking & Video",
      "Writing & Poetry",
      "Digital & AI Art",
      "Crafts & Handmade",
    ],
  },
  {
    label: "Creator & Growth",
    topics: [
      "Creator Economy",
      "Social Media & Growth",
      "Marketing & Advertising",
      "Live & Streaming",
      "Trends & Challenges",
      "Self-Improvement",
    ],
  },
  {
    label: "Learning & Ideas",
    topics: [
      "Education & Study",
      "Languages & Culture",
      "History",
      "Philosophy & Ideas",
      "How-To & Tutorials",
    ],
  },
];

/** Every topic, flat — the studio's picker and search corpora. */
export const CATEGORIES: Category[] = CATEGORY_GROUPS.flatMap(
  (g) => g.topics,
);

/**
 * What Explore's filter row shows when nothing is live: a spread of the
 * topics that pull the most streams, not an alphabet of 100 chips.
 */
export const POPULAR_CATEGORIES: Category[] = [
  "Just Chatting",
  "Crypto Markets",
  "Charts & Technical Analysis",
  "Memecoins & Degen",
  "Football (Soccer)",
  "Video Games",
  "Afrobeats & Amapiano",
  "AI & Machine Learning",
];

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
  /** People live on the stage beside the host — a co-live renders as an
   *  overlapping facepile and "Host with Guest" on the card. */
  liveGuests: Array<{ username: string; avatar: string }>;
  /** Current concurrent viewers — 0 once a stream has ended. */
  viewers: number;
  /** Resolved URL of the stream's thumbnail; "" when it has none. */
  thumbnailUrl: string;
  isLive: boolean;
  startedAt: string;
  duration: string;
  tags: string[];
};

export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}
