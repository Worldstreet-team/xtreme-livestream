/**
 * Cover photography for every category, live or not.
 *
 * The categories endpoint supplies a cover only for categories with someone
 * streaming in them — the busiest live thumbnail. Everything else used to
 * fall back to a generated chart, which is exactly the tile that reads as
 * dead on an onboarding screen meant to feel alive. This gives each vertical
 * a set of real photographs, and each category a stable pick from its set,
 * so a grid of thirty categories is thirty different real images.
 *
 * All ids are verified Unsplash photos. Sized for the surface at request
 * time; the same id at two sizes is the same picture.
 */

import { CATEGORY_GROUPS } from "@/lib/categories";
import { twitchArtFor } from "@/lib/twitch-categories";

type Vertical =
  | "markets"
  | "crypto"
  | "sports"
  | "gaming"
  | "music"
  | "talk"
  | "tech"
  | "lifestyle"
  | "learning";

const SETS: Record<Vertical, string[]> = {
  markets: [
    "1611974789855-9c2a0a7236a3", "1590283603385-17ffb3a7f29f", "1642790106117-e829e14a795f",
    "1559526324-4b87b5e36e44", "1612178537253-bccd437b730e", "1573164713988-8665fc963095",
    "1516245834210-c4c142787335",
  ],
  crypto: [
    "1518186285589-2f7649de83e0", "1621761191319-c6fb62004040", "1640340434855-6084b1f4901c",
    "1639762681485-074b7f938ba0",
  ],
  sports: [
    "1522778119026-d647f0596c20", "1489944440615-453fc2b6a9a9", "1431324155629-1a6deb1dec8d",
    "1543326727-cf6c39e8f84c", "1574629810360-7efbbe195018", "1560272564-c83b66b1ad12",
    "1517927033932-b3d18e61fb3a",
  ],
  gaming: [
    "1542751371-adc38448a05e", "1516450360452-9312f5e86fc7", "1550745165-9bc0b252726f",
    "1493711662062-fa541adb3fc8", "1511512578047-dfb367046420", "1587202372775-e229f172b9d7",
    "1538481199705-c710c4e965fc", "1560253023-3ec5d502959f", "1552820728-8b83bb6b773f",
  ],
  music: [
    "1470225620780-dba8ba36b745", "1493225457124-a3eb161ffa5f", "1514320291840-2e0a9bf2a9ae",
    "1516280440614-37939bbacd81", "1459749411175-04bf5292ceea", "1571330735066-03aaa9429d89",
    "1524368535928-5b5e00ddc76b", "1508973379184-7517410fb0bc",
  ],
  talk: [
    "1495020689067-958852a7765e", "1590602847861-f357a9332bbc", "1478737270239-2f02b77fc618",
    "1589903308904-1010c2294adc", "1517048676732-d65bc937f952", "1521737604893-d14cc237f11d",
    "1573497019940-1c28c88b4f3e", "1544717305-2782549b5136",
  ],
  tech: [
    "1531297484001-80022131f5a1", "1517180102446-f3ece451e9d8", "1555949963-aa79dcee981c",
    "1461749280684-dccba630e2f6", "1498050108023-c5249f4df085", "1504384308090-c894fdcc538d",
    "1487058792275-0ad4aaf24ca7", "1607705703571-c5a8695f18f6",
  ],
  lifestyle: [
    "1517048676732-d65bc937f952", "1521737604893-d14cc237f11d", "1544717305-2782549b5136",
    "1470225620780-dba8ba36b745", "1552374196-c4e7ffc6e126",
  ],
  learning: [
    "1461749280684-dccba630e2f6", "1498050108023-c5249f4df085", "1495020689067-958852a7765e",
    "1573497019940-1c28c88b4f3e",
  ],
};

/** Which photo set a vertical label maps to. */
function verticalFor(group: string, category: string): Vertical {
  const g = group.toLowerCase();
  const c = category.toLowerCase();
  if (/crypto|web3|nft|defi|memecoin/.test(c) || /crypto/.test(g)) return "crypto";
  if (/market|trading|stock|forex|option|indices|bond|ipo|commodit/.test(c) || /market/.test(g)) return "markets";
  if (/sport|football|basket|tennis|fight|boxing|racing/.test(c) || /sport/.test(g)) return "sports";
  if (/game|gaming|esport|speedrun/.test(c) || /gaming/.test(g)) return "gaming";
  if (/music|afrobeat|amapiano|dj|podcast|audio/.test(c) || /music|audio/.test(g)) return "music";
  if (/chat|talk|irl|just/.test(c) || /general/.test(g)) return "talk";
  if (/ai|machine|tech|code|develop|software|crypto mining/.test(c) || /tech/.test(g)) return "tech";
  if (/learn|education|study|language|history|philosoph|how-to/.test(c) || /learn/.test(g)) return "learning";
  return "lifestyle";
}

// Stable index per category within its set: the same category always gets
// the same picture, and neighbours in a vertical get different ones.
const INDEX = new Map<string, { vertical: Vertical; index: number }>();
for (const group of CATEGORY_GROUPS) {
  const counters = new Map<Vertical, number>();
  for (const topic of group.topics) {
    const vertical = verticalFor(group.label, topic);
    const n = counters.get(vertical) ?? 0;
    counters.set(vertical, n + 1);
    INDEX.set(topic, { vertical, index: n });
  }
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * A real photograph for a category, at the requested size. Landscape for
 * cards and tiles, portrait for box art. Categories outside the taxonomy
 * still get a stable picture from a hashed pick.
 */
export function categoryArt(
  category: string,
  size: { w: number; h: number } = { w: 800, h: 450 }
) {
  // Portrait requests are box art: if Twitch files this category, its
  // artwork is the picture people already recognise it by.
  if (size.h > size.w) {
    const twitch = twitchArtFor(category, size.w, size.h);
    if (twitch) return twitch;
  }
  const known = INDEX.get(category);
  const vertical = known?.vertical ?? verticalFor("", category);
  const set = SETS[vertical];
  const index = known?.index ?? hash(category);
  const id = set[index % set.length];
  return `https://images.unsplash.com/photo-${id}?w=${size.w}&h=${size.h}&fit=crop&crop=entropy&q=72&fm=jpg`;
}

/** Portrait box art, the shape category cards use. */
export function categoryPoster(category: string) {
  return categoryArt(category, { w: 480, h: 640 });
}
