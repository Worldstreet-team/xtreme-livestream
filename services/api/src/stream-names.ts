/**
 * What an untitled stream is called. A title is optional (owner,
 * 2026-09-28: "they can go live without a name though … we'll do it
 * creatively on the backend"), so the server names it from the two things
 * it always has, the host and the category, with one rule per kind of
 * stream. Nothing is random, so clearing a title twice gives the same name:
 *
 *   Just Chatting, IRL, Podcasts & Talk → "Just Chatting with Amara"
 *   a game (the studio's Games titles)  → "Amara plays VALORANT"
 *   any other category                  → "Amara on Afrobeats"
 *   no category                         → "Live with Amara"
 *   no name at all                      → "Live on Xtream"
 *
 * Other categories drop their second half ("Afrobeats & Amapiano" →
 * "Afrobeats", "Football (Soccer)" → "Football") so the name reads like a
 * show, not a taxonomy. It reads right on a live card and on the
 * past-broadcasts shelf, and needs no guess at the host's time zone.
 */

/** Categories that are a conversation: the category leads and the host joins it. */
const HANGOUTS: ReadonlySet<string> = new Set(["Just Chatting", "IRL", "Podcasts & Talk"]);

/**
 * Titles you play. Mirrors the "Games" group in the web app's
 * lib/categories.ts (test/untitled-streams.test.ts fails when they drift),
 * plus the general "Video Games".
 */
export const GAME_TITLES: ReadonlySet<string> = new Set([
  "Garena Free Fire", "Fortnite", "Call of Duty", "Minecraft", "VALORANT", "League of Legends",
  "Marvel Rivals", "Apex Legends", "PUBG: BATTLEGROUNDS", "Marathon", "Elden Ring: Nightreign", "Roblox",
  "Mobile Legends: Bang Bang", "Grand Theft Auto V", "PUBG Mobile", "Call of Duty: Mobile",
  "EA Sports FC 26", "Arena of Valor", "eFootball", "Rocket League", "Blood Strike", "Counter-Strike",
  "Dead by Daylight", "Resident Evil", "NBA 2K27", "Clash Royale", "Rainbow Six Siege", "Honor of Kings",
  "Aniimo", "Dota 2", "Genshin Impact", "Lineage 2", "Euro Truck Simulator 2", "Delta Force", "Overwatch",
  "Brawl Stars", "World of Warcraft", "Red Dead Redemption II", "Pokémon GO", "Car Parking Multiplayer",
  "8 Ball Pool", "Geometry Dash", "Ludo", "Once Human", "Among Us", "Marvel's Wolverine", "Battlefield 2042",
  "Clash of Clans", "Left 4 Dead 2", "VRChat", "Elden Ring", "Subway Surfers", "Knives Out",
  "Dream League Soccer", "Arena Breakout", "The Legend of Zelda: Breath of the Wild", "Super Mario 64",
  "Rust", "Phasmophobia", "Hollow Knight", "Standoff 2", "Teamfight Tactics", "God of War", "The Last of Us",
  "Battlefield 6", "Valheim", "R.E.P.O.", "Point Blank", "Forza Horizon 5", "Only Up!", "The Isle",
  "Retro Gaming", "The Sims 4", "Mario Kart 8 Deluxe", "Warframe", "Assetto Corsa", "MU Online", "CrossFire",
  "Dragon Ball Legends", "Word Cookies", "Tibia", "Mortal Kombat 11", "Arena Breakout: Infinite",
  "Farming Simulator 25", "Final Fantasy", "Growtopia", "Halo Infinite", "DayZ", "Destiny 2", "War Thunder",
  "Escape from Tarkov", "Slither.io", "Black Myth: Wukong", "Diablo II: Resurrected", "Stardew Valley",
  "Plants vs. Zombies", "Tetris", "The King of Fighters XV", "Brawlhalla", "Palworld", "Project Zomboid",
  "World of Tanks", "Hearthstone", "Black Desert", "Street Fighter 6", "Call of Duty: Warzone",
  "Old School RuneScape", "FINAL FANTASY XIV ONLINE", "Deadlock", "EVE Online",
  "The Elder Scrolls V: Skyrim", "ARC Raiders", "Super Smash Bros. Ultimate", "TEKKEN 8", "Star Citizen",
  "Magic: The Gathering", "Terraria", "F1 25", "Monster Hunter Wilds", "Madden NFL 27",
  "Call of Duty: Black Ops 7", "Diablo IV", "Baldur's Gate 3", "HELLDIVERS 2", "Fall Guys", "Chess", "Poker",
  "Video Games",
]);

const MAX = 100;

/** "Afrobeats & Amapiano" → "Afrobeats"; "R&B, Soul & Jazz" → "R&B"; "Football (Soccer)" → "Football". */
export function shortCategory(category: string) {
  const c = category.trim();
  return c.split(/ \(|, | & | \/ /)[0]?.trim() || c;
}

export function defaultStreamTitle(host: { displayName?: string | null; username?: string | null }, category?: string | null) {
  const name = (host.displayName || host.username || "").trim();
  if (!name) return "Live on Xtream";
  const c = (category ?? "").trim();
  let title: string;
  if (!c) title = `Live with ${name}`;
  else if (HANGOUTS.has(c)) title = `${c} with ${name}`;
  else if (GAME_TITLES.has(c)) title = `${name} plays ${c}`;
  else title = `${name} on ${shortCategory(c)}`;
  return title.slice(0, MAX);
}
