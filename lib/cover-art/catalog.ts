/**
 * What each category's cover is made of: its family (the taxonomy group),
 * the family's motif and grounds, and the category's own mark.
 *
 * Every cover in the app is drawn from this table by `coverSvg` — there is
 * no third-party artwork anywhere in it. A family shares a motif and a pair
 * of grounds, so a row of Sports covers reads as one set; the mark (an icon
 * from our Solar set, or for a game title its monogram) and a pattern seeded
 * from the name make each one recognisable inside the set.
 *
 * Game titles carry a genre instead of an icon: the genre picks the motif,
 * the small icon beside the kicker and the grounds, and the title's initials
 * are the hero. Nothing here is a publisher's logo or type.
 */

import { CATEGORY_GROUPS } from "../categories";

export type Motif =
  | "dots"
  | "contour"
  | "candles"
  | "hex"
  | "lattice"
  | "pixels"
  | "claws"
  | "speed"
  | "field"
  | "burst"
  | "slashes"
  | "columns"
  | "eq"
  | "waves"
  | "circuit"
  | "graph"
  | "shapes"
  | "orbit"
  | "pulse"
  | "arches"
  | "iso"
  | "press"
  | "film"
  | "rings"
  | "crosshair"
  | "zone"
  | "vinyl"
  | "signal";

/** Grounds. Each is a flat, complete palette; see `SCHEMES` in ./index. */
export type Scheme =
  | "night"
  | "chiliNight"
  | "emberNight"
  | "chili"
  | "ember"
  | "crimson"
  | "bone"
  | "stem"
  | "ink";

export type Sport =
  | "football"
  | "basketball"
  | "gridiron"
  | "cricket"
  | "tennis"
  | "track"
  | "ring"
  | "motor"
  | "golf"
  | "diamond";

export type Genre =
  | "shooter"
  | "royale"
  | "moba"
  | "strategy"
  | "rpg"
  | "mmo"
  | "sandbox"
  | "survival"
  | "horror"
  | "racing"
  | "sports"
  | "fighting"
  | "action"
  | "platformer"
  | "party"
  | "puzzle"
  | "sim"
  | "tabletop";

export interface Family {
  /** The short word set above the name. */
  kicker: string;
  motif: Motif;
  /** Grounds, alternated through the family so neighbours differ. */
  schemes: Scheme[];
  /** Icon when a topic doesn't name its own. */
  icon: string;
}

/** Keyed by `CATEGORY_GROUPS[].label`. */
export const FAMILIES: Record<string, Family> = {
  General: { kicker: "Live", motif: "dots", schemes: ["chili", "night"], icon: "chat-round-dots" },
  "Markets & Trading": { kicker: "Markets", motif: "candles", schemes: ["night", "bone"], icon: "graph-new-up" },
  "Crypto & Web3": { kicker: "Crypto", motif: "iso", schemes: ["emberNight", "ember"], icon: "blocks" },
  "Business & Money": { kicker: "Business", motif: "columns", schemes: ["bone", "night"], icon: "case-round" },
  Technology: { kicker: "Tech", motif: "circuit", schemes: ["ink", "night"], icon: "cpu" },
  "News & Society": { kicker: "News", motif: "press", schemes: ["bone", "crimson"], icon: "earth" },
  Sports: { kicker: "Sports", motif: "field", schemes: ["chili", "night", "ember"], icon: "cup-first" },
  Gaming: { kicker: "Gaming", motif: "pixels", schemes: ["chiliNight", "ember"], icon: "gamepad" },
  Games: { kicker: "Game", motif: "pixels", schemes: ["night"], icon: "gamepad" },
  Entertainment: { kicker: "Entertainment", motif: "burst", schemes: ["crimson", "chiliNight"], icon: "star-shine" },
  "Music & Audio": { kicker: "Music", motif: "eq", schemes: ["ember", "emberNight"], icon: "music-note-2" },
  Lifestyle: { kicker: "Lifestyle", motif: "arches", schemes: ["bone", "chiliNight"], icon: "hearts" },
  "Health & Wellness": { kicker: "Wellness", motif: "pulse", schemes: ["stem", "bone"], icon: "heart-pulse" },
  "Arts & Creative": { kicker: "Creative", motif: "shapes", schemes: ["bone", "night"], icon: "palette" },
  "Creator & Growth": { kicker: "Creators", motif: "signal", schemes: ["chili", "emberNight"], icon: "station" },
  "Learning & Ideas": { kicker: "Learning", motif: "graph", schemes: ["ink", "bone"], icon: "lightbulb" },
};

export interface TopicStyle {
  icon?: string;
  motif?: Motif;
  sport?: Sport;
}

/** Per-topic marks and motif overrides, for every non-game topic. */
export const TOPICS: Record<string, TopicStyle> = {
  // General
  "Just Chatting": { icon: "chat-round-dots" },
  IRL: { icon: "map-point-wave", motif: "contour" },
  // Markets & Trading
  "Stocks & Equities": { icon: "chart-2" },
  "Crypto Markets": { icon: "course-up" },
  "Forex & Currencies": { icon: "euro", motif: "waves" },
  Commodities: { icon: "fuel", motif: "eq" },
  "Options & Derivatives": { icon: "branching-paths-up" },
  "Indices & ETFs": { icon: "pie-chart-2" },
  "Bonds & Rates": { icon: "bill-list", motif: "waves" },
  "Charts & Technical Analysis": { icon: "graph-new-up" },
  "IPOs & Listings": { icon: "bell-bing", motif: "burst" },
  // Crypto & Web3
  DeFi: { icon: "transfer-horizontal", motif: "hex" },
  "NFTs & Collectibles": { icon: "gallery-wide", motif: "pixels" },
  "Blockchain & Protocols": { icon: "blocks" },
  "Memecoins & Degen": { icon: "rocket", motif: "burst" },
  // Business & Money
  "Personal Finance": { icon: "wallet-money" },
  "Real Estate & Property": { icon: "buildings-2", motif: "iso" },
  "Startups & VC": { icon: "rocket-2", motif: "signal" },
  Entrepreneurship: { icon: "case-round" },
  "Careers & Jobs": { icon: "suitcase", motif: "graph" },
  "Economy & Macro": { icon: "global", motif: "waves" },
  "Fintech & Banking": { icon: "card" },
  "Tax & Regulation": { icon: "calculator", motif: "graph" },
  "Side Hustles & Freelance": { icon: "laptop" },
  // Technology
  "AI & Machine Learning": { icon: "bot" },
  "Software & Coding": { icon: "code-square" },
  "Gadgets & Consumer Tech": { icon: "smartphone", motif: "iso" },
  "Cybersecurity & Safety": { icon: "shield-keyhole", motif: "hex" },
  "Space & Aerospace": { icon: "planet", motif: "orbit" },
  "Science & Research": { icon: "test-tube", motif: "orbit" },
  "Robotics & Hardware": { icon: "cpu" },
  "Energy & Climate Tech": { icon: "bolt", motif: "waves" },
  // News & Society
  "World News": { icon: "earth" },
  "Politics & Policy": { icon: "flag", motif: "slashes" },
  "Climate & Environment": { icon: "leaf", motif: "contour" },
  "Social Impact & Giving": { icon: "hand-heart", motif: "dots" },
  "Law & Justice": { icon: "scale", motif: "columns" },
  "Faith & Spirituality": { icon: "hand-stars", motif: "arches" },
  // Sports
  "Football (Soccer)": { icon: "football", sport: "football" },
  Basketball: { icon: "basketball", sport: "basketball" },
  "American Football": { icon: "rugby", sport: "gridiron" },
  Cricket: { icon: "balls", sport: "cricket" },
  Tennis: { icon: "tennis", sport: "tennis" },
  "Motorsport & F1": { icon: "wheel", sport: "motor" },
  "Boxing & MMA": { icon: "fire", sport: "ring" },
  "Athletics & Olympics": { icon: "running", sport: "track" },
  Golf: { icon: "golf", sport: "golf" },
  Baseball: { icon: "balls", sport: "diamond" },
  "Betting & Fantasy": { icon: "ticket-star", motif: "lattice" },
  // Gaming
  "Video Games": { icon: "gamepad" },
  "Mobile Gaming": { icon: "gameboy", motif: "dots" },
  Esports: { icon: "cup-star", motif: "burst" },
  "Chess & Tabletop": { icon: "crown-minimalistic", motif: "lattice" },
  // Entertainment
  "Movies & TV": { icon: "clapperboard-play", motif: "film" },
  "Anime & Manga": { icon: "star-fall" },
  "Celebrity & Pop Culture": { icon: "star-shine", motif: "dots" },
  "Comedy & Memes": { icon: "emoji-funny-circle" },
  "Podcasts & Talk": { icon: "podcast", motif: "signal" },
  "Books & Reading": { icon: "book-bookmark", motif: "press" },
  "Special Events": { icon: "confetti", motif: "dots" },
  // Music & Audio
  "Afrobeats & Amapiano": { icon: "boombox" },
  "Hip-Hop & Rap": { icon: "microphone-large", motif: "waves" },
  "Pop & Charts": { icon: "music-note-2" },
  "Rock & Metal": { icon: "speaker", motif: "slashes" },
  "Electronic & Dance": { icon: "soundwave-square", motif: "waves" },
  "Latin & Reggaeton": { icon: "music-notes" },
  "K-Pop & J-Pop": { icon: "hearts", motif: "dots" },
  "R&B, Soul & Jazz": { icon: "vinyl-record", motif: "vinyl" },
  "Gospel & Worship": { icon: "hand-stars", motif: "arches" },
  "Production & DJ": { icon: "turntable", motif: "vinyl" },
  // Lifestyle
  "Fashion & Style": { icon: "hanger-2" },
  "Beauty & Skincare": { icon: "cosmetic", motif: "dots" },
  "Food & Cooking": { icon: "chef-hat", motif: "shapes" },
  "Travel & Adventure": { icon: "plain-2", motif: "contour" },
  "Home & Interiors": { icon: "sofa-2" },
  "Cars & Automotive": { icon: "car", motif: "speed" },
  "Pets & Animals": { icon: "paw", motif: "dots" },
  "Family & Parenting": { icon: "users-group-two-rounded" },
  "Relationships & Dating": { icon: "hearts" },
  // Health & Wellness
  "Fitness & Training": { icon: "dumbbell-large" },
  "Nutrition & Diet": { icon: "plate", motif: "shapes" },
  "Mental Health": { icon: "brain", motif: "waves" },
  "Health & Medicine": { icon: "stethoscope" },
  "Mindfulness & Recovery": { icon: "meditation", motif: "rings" },
  ASMR: { icon: "headphones-round-sound", motif: "waves" },
  // Arts & Creative
  "Visual Art & Illustration": { icon: "palette" },
  Photography: { icon: "camera", motif: "rings" },
  "Design & UX": { icon: "ruler-pen", motif: "graph" },
  "Architecture & Cities": { icon: "city", motif: "iso" },
  "Filmmaking & Video": { icon: "videocamera-record", motif: "film" },
  "Writing & Poetry": { icon: "pen", motif: "press" },
  "Digital & AI Art": { icon: "magic-stick-3", motif: "pixels" },
  "Crafts & Handmade": { icon: "scissors", motif: "lattice" },
  // Creator & Growth
  "Creator Economy": { icon: "hand-money" },
  "Social Media & Growth": { icon: "hashtag-circle", motif: "eq" },
  "Marketing & Advertising": { icon: "sale", motif: "burst" },
  "Live & Streaming": { icon: "station" },
  "Trends & Challenges": { icon: "fire", motif: "slashes" },
  "Self-Improvement": { icon: "course-up", motif: "arches" },
  // Learning & Ideas
  "Education & Study": { icon: "square-academic-cap" },
  "Languages & Culture": { icon: "translation", motif: "press" },
  History: { icon: "library", motif: "columns" },
  "Philosophy & Ideas": { icon: "lightbulb", motif: "orbit" },
  "How-To & Tutorials": { icon: "toolbox" },
};

export interface GenreStyle {
  label: string;
  motif: Motif;
  icon: string;
  schemes: Scheme[];
}

/** A game's genre sets its motif, kicker icon and grounds. */
export const GENRES: Record<Genre, GenreStyle> = {
  shooter: { label: "Shooter", motif: "crosshair", icon: "target", schemes: ["night", "chiliNight", "chili"] },
  royale: { label: "Battle royale", motif: "zone", icon: "radar-2", schemes: ["emberNight", "ember", "night"] },
  moba: { label: "MOBA", motif: "hex", icon: "shield-star", schemes: ["crimson", "night"] },
  strategy: { label: "Strategy", motif: "hex", icon: "crown-minimalistic", schemes: ["bone", "emberNight"] },
  rpg: { label: "RPG", motif: "lattice", icon: "magic-stick", schemes: ["crimson", "night", "bone"] },
  mmo: { label: "MMO", motif: "orbit", icon: "planet", schemes: ["ink", "night"] },
  sandbox: { label: "Sandbox", motif: "pixels", icon: "box", schemes: ["ember", "stem"] },
  survival: { label: "Survival", motif: "contour", icon: "bonfire", schemes: ["stem", "emberNight"] },
  horror: { label: "Horror", motif: "claws", icon: "ghost", schemes: ["crimson", "night"] },
  racing: { label: "Racing", motif: "speed", icon: "wheel", schemes: ["chili", "night"] },
  sports: { label: "Sports", motif: "field", icon: "football", schemes: ["chili", "ember", "night"] },
  fighting: { label: "Fighting", motif: "burst", icon: "fire", schemes: ["chili", "crimson"] },
  action: { label: "Action", motif: "slashes", icon: "bolt", schemes: ["chiliNight", "ember", "night"] },
  platformer: { label: "Platformer", motif: "pixels", icon: "gamepad-old", schemes: ["ember", "chiliNight"] },
  party: { label: "Party", motif: "dots", icon: "confetti", schemes: ["chili", "ember"] },
  puzzle: { label: "Puzzle", motif: "pixels", icon: "widget-4", schemes: ["bone", "ink"] },
  sim: { label: "Simulation", motif: "iso", icon: "home-smile", schemes: ["stem", "bone"] },
  tabletop: { label: "Tabletop", motif: "lattice", icon: "crown", schemes: ["bone", "stem", "crimson"] },
};

export interface GameStyle {
  genre: Genre;
  /** Initials for the hero when the automatic ones read wrong. */
  mono?: string;
  icon?: string;
  sport?: Sport;
}

/** Every title in the Games group. */
export const GAMES: Record<string, GameStyle> = {
  "Garena Free Fire": { genre: "royale", mono: "FF" },
  Fortnite: { genre: "royale" },
  "Call of Duty": { genre: "shooter", mono: "COD" },
  Minecraft: { genre: "sandbox" },
  VALORANT: { genre: "shooter" },
  "League of Legends": { genre: "moba", mono: "LOL" },
  "Marvel Rivals": { genre: "shooter", mono: "MR" },
  "Apex Legends": { genre: "royale" },
  "PUBG: BATTLEGROUNDS": { genre: "royale", mono: "PUBG" },
  Marathon: { genre: "shooter" },
  "Elden Ring: Nightreign": { genre: "rpg", mono: "ERN" },
  Roblox: { genre: "sandbox" },
  "Mobile Legends: Bang Bang": { genre: "moba", mono: "MLBB" },
  "Grand Theft Auto V": { genre: "action", mono: "GTA" },
  "PUBG Mobile": { genre: "royale", mono: "PUBG" },
  "Call of Duty: Mobile": { genre: "shooter", mono: "CODM" },
  "EA Sports FC 26": { genre: "sports", mono: "FC26", icon: "football", sport: "football" },
  "Arena of Valor": { genre: "moba", mono: "AOV" },
  eFootball: { genre: "sports", mono: "EF", icon: "football", sport: "football" },
  "Rocket League": { genre: "sports", mono: "RL", icon: "car", sport: "football" },
  "Blood Strike": { genre: "shooter", mono: "BS" },
  "Counter-Strike": { genre: "shooter", mono: "CS" },
  "Dead by Daylight": { genre: "horror", mono: "DBD" },
  "Resident Evil": { genre: "horror", mono: "RE" },
  "NBA 2K27": { genre: "sports", mono: "2K27", icon: "basketball", sport: "basketball" },
  "Clash Royale": { genre: "strategy", mono: "CR" },
  "Rainbow Six Siege": { genre: "shooter", mono: "R6" },
  "Honor of Kings": { genre: "moba", mono: "HOK" },
  Aniimo: { genre: "rpg" },
  "Dota 2": { genre: "moba", mono: "D2" },
  "Genshin Impact": { genre: "rpg", mono: "GI" },
  "Lineage 2": { genre: "mmo", mono: "L2" },
  "Euro Truck Simulator 2": { genre: "sim", mono: "ETS2", icon: "delivery" },
  "Delta Force": { genre: "shooter", mono: "DF" },
  Overwatch: { genre: "shooter" },
  "Brawl Stars": { genre: "party", mono: "BS" },
  "World of Warcraft": { genre: "mmo", mono: "WOW" },
  "Red Dead Redemption II": { genre: "action", mono: "RDR2" },
  "Pokémon GO": { genre: "puzzle", mono: "GO", icon: "map-point-wave" },
  "Car Parking Multiplayer": { genre: "racing", mono: "CPM", icon: "car" },
  "8 Ball Pool": { genre: "tabletop", mono: "8", icon: "balls" },
  "Geometry Dash": { genre: "platformer", mono: "GD" },
  Ludo: { genre: "tabletop" },
  "Once Human": { genre: "survival", mono: "OH" },
  "Among Us": { genre: "party", mono: "AU" },
  "Marvel's Wolverine": { genre: "action", mono: "W" },
  "Battlefield 2042": { genre: "shooter", mono: "BF" },
  "Clash of Clans": { genre: "strategy", mono: "COC" },
  "Left 4 Dead 2": { genre: "horror", mono: "L4D2" },
  VRChat: { genre: "party", mono: "VR" },
  "Elden Ring": { genre: "rpg", mono: "ER" },
  "Subway Surfers": { genre: "platformer", mono: "SS" },
  "Knives Out": { genre: "royale", mono: "KO" },
  "Dream League Soccer": { genre: "sports", mono: "DLS", icon: "football", sport: "football" },
  "Arena Breakout": { genre: "shooter", mono: "AB" },
  "The Legend of Zelda: Breath of the Wild": { genre: "rpg", mono: "BOTW" },
  "Super Mario 64": { genre: "platformer", mono: "64" },
  Rust: { genre: "survival" },
  Phasmophobia: { genre: "horror" },
  "Hollow Knight": { genre: "platformer", mono: "HK" },
  "Standoff 2": { genre: "shooter", mono: "SO2" },
  "Teamfight Tactics": { genre: "strategy", mono: "TFT" },
  "God of War": { genre: "action", mono: "GOW" },
  "The Last of Us": { genre: "survival", mono: "TLOU" },
  "Battlefield 6": { genre: "shooter", mono: "BF6" },
  Valheim: { genre: "survival" },
  "R.E.P.O.": { genre: "horror", mono: "REPO" },
  "Point Blank": { genre: "shooter", mono: "PB" },
  "Forza Horizon 5": { genre: "racing", mono: "FH5" },
  "Only Up!": { genre: "platformer", mono: "UP" },
  "The Isle": { genre: "survival", mono: "ISLE" },
  "Retro Gaming": { genre: "platformer", mono: "8BIT", icon: "gamepad-old" },
  "The Sims 4": { genre: "sim", mono: "S4" },
  "Mario Kart 8 Deluxe": { genre: "racing", mono: "MK8" },
  Warframe: { genre: "action" },
  "Assetto Corsa": { genre: "racing", mono: "AC" },
  "MU Online": { genre: "mmo", mono: "MU" },
  CrossFire: { genre: "shooter", mono: "CF" },
  "Dragon Ball Legends": { genre: "fighting", mono: "DBL" },
  "Word Cookies": { genre: "puzzle", mono: "WC" },
  Tibia: { genre: "mmo" },
  "Mortal Kombat 11": { genre: "fighting", mono: "MK11" },
  "Arena Breakout: Infinite": { genre: "shooter", mono: "ABI" },
  "Farming Simulator 25": { genre: "sim", mono: "FS25", icon: "leaf" },
  "Final Fantasy": { genre: "rpg", mono: "FF" },
  Growtopia: { genre: "sandbox" },
  "Halo Infinite": { genre: "shooter", mono: "HALO" },
  DayZ: { genre: "survival", mono: "DZ" },
  "Destiny 2": { genre: "shooter", mono: "D2" },
  "War Thunder": { genre: "shooter", mono: "WT" },
  "Escape from Tarkov": { genre: "shooter", mono: "EFT" },
  "Slither.io": { genre: "puzzle", mono: "IO" },
  "Black Myth: Wukong": { genre: "action", mono: "BMW" },
  "Diablo II: Resurrected": { genre: "rpg", mono: "D2R" },
  "Stardew Valley": { genre: "sim", mono: "SV" },
  "Plants vs. Zombies": { genre: "strategy", mono: "PVZ" },
  Tetris: { genre: "puzzle" },
  "The King of Fighters XV": { genre: "fighting", mono: "KOF" },
  Brawlhalla: { genre: "fighting" },
  Palworld: { genre: "survival" },
  "Project Zomboid": { genre: "survival", mono: "PZ" },
  "World of Tanks": { genre: "shooter", mono: "WOT" },
  Hearthstone: { genre: "tabletop", mono: "HS" },
  "Black Desert": { genre: "mmo", mono: "BD" },
  "Street Fighter 6": { genre: "fighting", mono: "SF6" },
  "Call of Duty: Warzone": { genre: "royale", mono: "WZ" },
  "Old School RuneScape": { genre: "mmo", mono: "OSRS" },
  "FINAL FANTASY XIV ONLINE": { genre: "mmo", mono: "XIV" },
  Deadlock: { genre: "moba" },
  "EVE Online": { genre: "mmo", mono: "EVE" },
  "The Elder Scrolls V: Skyrim": { genre: "rpg", mono: "TES5" },
  "ARC Raiders": { genre: "shooter", mono: "ARC" },
  "Super Smash Bros. Ultimate": { genre: "fighting", mono: "SSBU" },
  "TEKKEN 8": { genre: "fighting", mono: "T8" },
  "Star Citizen": { genre: "mmo", mono: "SC" },
  "Magic: The Gathering": { genre: "tabletop", mono: "MTG" },
  Terraria: { genre: "sandbox" },
  "F1 25": { genre: "racing", mono: "F1" },
  "Monster Hunter Wilds": { genre: "rpg", mono: "MHW" },
  "Madden NFL 27": { genre: "sports", mono: "M27", icon: "rugby", sport: "gridiron" },
  "Call of Duty: Black Ops 7": { genre: "shooter", mono: "BO7" },
  "Diablo IV": { genre: "rpg", mono: "D4" },
  "Baldur's Gate 3": { genre: "rpg", mono: "BG3" },
  "HELLDIVERS 2": { genre: "shooter", mono: "HD2" },
  "Fall Guys": { genre: "party", mono: "FG" },
  Chess: { genre: "tabletop", icon: "crown-minimalistic" },
  Poker: { genre: "tabletop", icon: "ticket-star" },
};

/** Taxonomy lookups: topic → family label, and its index inside the family. */
export const FAMILY_OF = new Map<string, { group: string; index: number }>();
for (const g of CATEGORY_GROUPS) g.topics.forEach((t, index) => FAMILY_OF.set(t, { group: g.label, index }));

/**
 * The family a free-string category (an old stream's retired label) falls
 * into, by keyword. Anything unrecognised is General.
 */
export function familyByKeyword(category: string): string {
  const c = category.toLowerCase();
  if (/crypto|web3|nft|defi|token|coin|chain/.test(c)) return "Crypto & Web3";
  if (/market|trad|stock|forex|option|indices|bond|ipo|commodit|chart/.test(c)) return "Markets & Trading";
  if (/sport|football|soccer|basket|tennis|fight|boxing|mma|racing|cricket|golf|ufc|nba|nfl/.test(c)) return "Sports";
  if (/game|gaming|esport|speedrun|play/.test(c)) return "Gaming";
  if (/music|afro|amapiano|dj|song|audio|rap|beats|concert/.test(c)) return "Music & Audio";
  if (/\bai\b|tech|code|coding|develop|software|science|space/.test(c)) return "Technology";
  if (/news|politic|world|society/.test(c)) return "News & Society";
  if (/money|business|finance|startup|career/.test(c)) return "Business & Money";
  if (/learn|educat|study|language|history|philosoph|how-to|tutorial/.test(c)) return "Learning & Ideas";
  if (/art|design|photo|film|draw|craft|writ/.test(c)) return "Arts & Creative";
  if (/fit|health|yoga|diet|wellness|mind/.test(c)) return "Health & Wellness";
  if (/food|cook|travel|fashion|beauty|car|pet|home/.test(c)) return "Lifestyle";
  if (/movie|tv|anime|comedy|podcast|celeb|event/.test(c)) return "Entertainment";
  if (/creator|stream|social|marketing|trend/.test(c)) return "Creator & Growth";
  return "General";
}

/** Every icon name the covers can draw — the asset build reads this. */
export function iconNames(): string[] {
  const names = new Set<string>();
  for (const f of Object.values(FAMILIES)) names.add(f.icon);
  for (const t of Object.values(TOPICS)) if (t.icon) names.add(t.icon);
  for (const g of Object.values(GENRES)) names.add(g.icon);
  for (const g of Object.values(GAMES)) if (g.icon) names.add(g.icon);
  return [...names].sort();
}
