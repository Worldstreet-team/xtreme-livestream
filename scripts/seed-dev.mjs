// Local dev seed: fills the local MongoDB with a realistic set of live
// streams so the grid, the stream page and the sidebar have something to
// render. Safe to re-run — it wipes only the collections it writes.
//
// This is a live-streaming platform, not a trading terminal: the cast spans
// gaming, football, music, cooking, IRL, art, comedy, anime, cars and
// fitness, with markets as one lane among many. Thumbnails and avatars are
// REAL photographs, downloaded once and embedded as JPEG data URIs exactly
// the way a client-compressed upload would be, matched to each stream's
// subject and cached on disk. Every live stream also gets a short looping
// clip (CC0 / test footage, downloaded into public/dev-previews) so the
// hero and previews actually move — seeded rooms have no LiveKit track.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoClient, ObjectId } from "mongodb";

const URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB = process.env.MONGODB_DB_NAME || "xtreme-livestream";

/* ---------- real photography ---------- */

const CACHE = path.join(os.tmpdir(), "xtreme-seed-photos");
fs.mkdirSync(CACHE, { recursive: true });

/** Verified Unsplash photo ids, grouped by what they show. */
const PHOTOS = {
  trading: [
    "1611974789855-9c2a0a7236a3", "1518186285589-2f7649de83e0", "1590283603385-17ffb3a7f29f",
    "1642790106117-e829e14a795f", "1621761191319-c6fb62004040", "1640340434855-6084b1f4901c",
    "1639762681485-074b7f938ba0", "1516245834210-c4c142787335", "1559526324-4b87b5e36e44",
  ],
  football: [
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
  dance: [
    "1519389950473-47ba0277781c", "1551836022-d5d88e9218df", "1524178232363-1fb2b075b655",
    "1571902943202-507ec2618e8f",
  ],
  talk: [
    "1495020689067-958852a7765e", "1590602847861-f357a9332bbc", "1478737270239-2f02b77fc618",
    "1589903308904-1010c2294adc", "1517048676732-d65bc937f952", "1521737604893-d14cc237f11d",
    "1573497019940-1c28c88b4f3e", "1544717305-2782549b5136",
  ],
  comedy: [
    "1478147427282-58a87a120781", "1533174072545-7a4b6ad7a6c3", "1516426122078-c23e76319801",
  ],
  cooking: [
    "1556910103-1c02745aae4d", "1556909114-f6e7ad7d3136", "1504674900247-0877df9cc836",
  ],
  travel: [
    "1551632811-561732d1e306", "1476514525535-07fb3b4ae5f1", "1527980965255-d3b416303d12",
  ],
  art: [
    "1513364776144-60967b0f800f", "1460661419201-fd4cecdf8a8b", "1547891654-e66ed7ebb968",
  ],
  fitness: [
    "1571019613454-1cb2f99b2d8b", "1534438327276-14e5300c3a48", "1517836357463-d25dfeac3438",
  ],
  fashion: [
    "1585699324551-f6c309eedeca", "1478720568477-152d9b164e26", "1493809842364-78817add7ffb",
  ],
  anime: ["1536922246289-88c42f957773", "1540039155733-5bb30b53aa14"],
  cars: ["1445019980597-93fa8acb246c", "1488646953014-85cb44e25828"],
  tech: [
    "1531297484001-80022131f5a1", "1517180102446-f3ece451e9d8", "1555949963-aa79dcee981c",
    "1461749280684-dccba630e2f6", "1498050108023-c5249f4df085", "1504384308090-c894fdcc538d",
  ],
  portrait: [
    "1494790108377-be9c29b29330", "1500648767791-00dcc994a43e", "1534528741775-53994a69daeb",
    "1507003211169-0a1dd7228f2d", "1517841905240-472988babdf9", "1438761681033-6461ffad8d80",
    "1544005313-94ddf0286df2", "1552374196-c4e7ffc6e126", "1531123897727-8f129e1688ce",
    "1506794778202-cad84cf45f1d", "1524504388940-b1c1722653e1", "1463453091185-61582044d556",
    "1583394838336-acd977736f90", "1554080353-a576cf803bda", "1493809842364-78817add7ffb",
    "1478720568477-152d9b164e26",
  ],
};

/** Which photo set a category belongs to. */
function topicFor(category = "") {
  const c = category.toLowerCase();
  if (/football|soccer|basket|boxing|mma|tennis|cricket|athlet/.test(c)) return "football";
  if (/motorsport|f1|car/.test(c)) return "cars";
  if (/game|gaming|esport|chess/.test(c)) return "gaming";
  if (/electronic|dance|dj|production/.test(c)) return "dance";
  if (/music|afrobeat|amapiano|hip-hop|pop|rock|latin|k-pop|r&b|gospel/.test(c)) return "music";
  if (/comedy|meme/.test(c)) return "comedy";
  if (/food|cook/.test(c)) return "cooking";
  if (/irl|travel|adventure/.test(c)) return "travel";
  if (/art|design|creativ/.test(c)) return "art";
  if (/fitness|health|sport/.test(c)) return "fitness";
  if (/fashion|beauty|style/.test(c)) return "fashion";
  if (/anime|manga|movie|tv|celebrity/.test(c)) return "anime";
  if (/chat|podcast|talk|book/.test(c)) return "talk";
  if (/ai |machine|tech|code|develop|software/.test(c)) return "tech";
  return "trading";
}

let downloaded = 0;
let cached = 0;

async function photo(topic, index, w, h) {
  const pool = PHOTOS[topic] ?? PHOTOS.talk;
  const id = pool[index % pool.length];
  const key = `${id}-${w}x${h}.jpg`;
  const file = path.join(CACHE, key);

  if (fs.existsSync(file)) {
    cached++;
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
  }

  const url = `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&crop=entropy&q=72&fm=jpg`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    // The document field caps at 200k characters; base64 inflates by ~4/3.
    if (buf.length < 3_000 || buf.length > 140_000) throw new Error("size");
    fs.writeFileSync(file, buf);
    downloaded++;
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null; // caller falls back to the generated frame
  }
}

/* ---------- looping preview clips ---------- */

// Real footage of people broadcasting (Pexels, free licence), grouped by
// what a stream in that category looks like. Each is cut to a 12 s muted
// 640×360 loop, and the stream's THUMBNAIL is a frame from the same clip —
// so the poster and the video that plays over it are the same picture.
// Served by the web app from public/dev-previews (gitignored).
const PREVIEW_DIR = path.resolve("public/dev-previews");
const PEXELS = (file) => `https://videos.pexels.com/video-files/${file}`;
const CLIP_POOLS = {
  gaming: [
    ["gaming-dark-room", PEXELS("9070661/9070661-sd_640_360_25fps.mp4")],
    ["gaming-posing", PEXELS("8128277/8128277-sd_640_360_25fps.mp4")],
    ["gaming-pizza", PEXELS("7047261/7047261-sd_640_360_25fps.mp4")],
    ["gaming-headphones", PEXELS("27153537/12085865_640_360_30fps.mp4")],
    ["gaming-man", PEXELS("9071269/9071269-sd_640_360_25fps.mp4")],
  ],
  talk: [
    ["ringlight-phone", PEXELS("12433102/12433102-sd_640_360_30fps.mp4")],
    ["broadcast-desk", PEXELS("2842988/2842988-sd_640_360_30fps.mp4")],
    ["phone-tripod", PEXELS("7514219/7514219-sd_640_360_25fps.mp4")],
    ["ringlight-setup", PEXELS("6332247/6332247-sd_960_506_25fps.mp4")],
    ["studio-switcher", PEXELS("37086543/15711140_640_360_25fps.mp4")],
  ],
  music: [
    ["dj-playing", PEXELS("5390434/5390434-sd_640_360_30fps.mp4")],
    ["dj-club", PEXELS("34940749/14800365_640_360_30fps.mp4")],
    ["dj-turntable", PEXELS("9004618/9004618-sd_640_360_25fps.mp4")],
    ["concert", PEXELS("7722216/7722216-sd_640_360_25fps.mp4")],
  ],
  cooking: [
    ["cooking-vlog", PEXELS("7963319/7963319-sd_640_360_25fps.mp4")],
    ["food-vlogger", PEXELS("12691853/12691853-sd_640_360_30fps.mp4")],
    ["cooking-self", PEXELS("7690411/7690411-sd_640_360_25fps.mp4")],
  ],
};

/** Which clip pool a category draws from. */
function clipPoolFor(category = "") {
  const c = category.toLowerCase();
  if (/game|gaming|esport/.test(c)) return "gaming";
  if (/music|afrobeat|amapiano|dance|dj|electronic/.test(c)) return "music";
  if (/food|cook/.test(c)) return "cooking";
  return "talk";
}

/** Download + transcode one clip, and cut its poster frame. Returns { url, frame } or null. */
async function prepareClip(name, sourceUrl) {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const file = path.join(PREVIEW_DIR, `${name}.mp4`);
  const frameFile = path.join(CACHE, `clip-${name}-800x450.jpg`);
  try {
    if (!fs.existsSync(file)) {
      const raw = path.join(os.tmpdir(), `xtreme-clip-${name}.src.mp4`);
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(String(res.status));
      fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
      execFileSync("ffmpeg", ["-y", "-v", "error", "-i", raw, "-t", "12", "-an", "-vf", "scale=640:-2,fps=24", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-movflags", "+faststart", file]);
      fs.unlinkSync(raw);
      console.log(`clip: prepared ${name}`);
    }
    if (!fs.existsSync(frameFile)) {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", "3", "-i", file, "-frames:v", "1", "-vf", "scale=800:450:force_original_aspect_ratio=increase,crop=800:450", "-q:v", "4", frameFile]);
    }
    return { url: `/dev-previews/${name}.mp4`, frame: `data:image/jpeg;base64,${fs.readFileSync(frameFile).toString("base64")}` };
  } catch (e) {
    console.log(`clip: skipped ${name} (${e.message})`);
    return null;
  }
}

/** Every pool prepared; the picker below hands them out per stream. */
async function fetchClips() {
  const pools = {};
  for (const [pool, list] of Object.entries(CLIP_POOLS)) {
    pools[pool] = [];
    for (const [name, url] of list) {
      const c = await prepareClip(name, url);
      if (c) pools[pool].push(c);
    }
  }
  return pools;
}

/* ---------- tiny PNG encoder (gradient thumbnails, no deps) ---------- */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** A 320x180 lit gradient frame — the last resort if a photo can't be had. */
function thumbnailPng(hue) {
  const W = 320, H = 180;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const lx = 0.28 + ((hue % 7) / 7) * 0.45;
  const ly = 0.3 + ((hue % 5) / 5) * 0.35;
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const t = u * 0.6 + v * 0.4;
      const dx = u - lx, dy = (v - ly) * (H / W);
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.1) ** 2;
      const [r, g, b] = hsl((hue + t * 70) % 360, 0.62 - glow * 0.25, 0.3 + t * 0.22 + glow * 0.34);
      const cx = (u - 0.5) * 2, cy = (v - 0.5) * 2;
      const vig = 1 - Math.min(0.55, (cx * cx + cy * cy) * 0.22);
      raw[p++] = Math.min(255, Math.round(r * vig));
      raw[p++] = Math.min(255, Math.round(g * vig));
      raw[p++] = Math.min(255, Math.round(b * vig));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/* ---------- cast ---------- */

// [username, displayName, bio, verified, followers]
const STREAMERS = [
  ["satoshiwatch", "Satoshi Watch", "BTC macro, every session open.", true, 184_000],
  ["amarapixels", "Amara Pixels", "Ranked grind. Mic always on.", false, 128_500],
  ["thegoalpost", "The Goalpost", "Match reactions and tactics.", true, 210_300],
  ["nnekabeats", "Nneka Beats", "Amapiano sets, live production.", false, 77_900],
  ["justmalik", "Just Malik", "Just chatting, mostly nonsense.", false, 55_100],
  ["chefkwame", "Chef Kwame", "Street food, big flames, no measuring.", true, 96_400],
  ["zaraonair", "Zara On Air", "Lagos to the world, phone in hand.", false, 143_200],
  ["tobidraws", "Tobi Draws", "Big canvases, small brushes, live.", false, 38_700],
  ["djlethal", "DJ Lethal", "House, amapiano, and whatever you request.", true, 121_600],
  ["funkefit", "Funke Fit", "Sweat with me from your living room.", false, 64_300],
  ["degenlagos", "Degen Lagos", "Memecoins and bad decisions.", false, 41_200],
  ["kojo_fx", "Kojo FX", "Forex + crypto correlation desk.", true, 63_800],
  ["priyaplays", "Priya Plays", "Mobile esports, ranked with subs.", true, 88_900],
  ["lanrelaughs", "Lanre Laughs", "Comedy hour, your DMs are the material.", false, 72_400],
  ["adaezewatches", "Adaeze Watches", "Anime watch parties and hot takes.", false, 29_800],
  ["midemotors", "Mide Motors", "Cars, detailing, track days.", false, 46_100],
];

// [title, category, tags, viewers, streamerIdx]  — one live room per streamer.
const STREAMS = [
  ["Ranked to Radiant — day 9, no sleep", "Video Games", ["valorant", "ranked"], 15_640, 1],
  ["Arsenal vs City — live watchalong", "Football (Soccer)", ["epl", "watchalong"], 31_205, 2],
  ["Amapiano log drum session, live from Lagos", "Afrobeats & Amapiano", ["amapiano", "live-set"], 6_120, 3],
  ["Rating your fits — send them in", "Just Chatting", ["chat", "fits"], 3_450, 4],
  ["Jollof cook-off: you vote, I cook", "Food & Cooking", ["jollof", "cookoff"], 4_880, 5],
  ["Lagos night market walk — IRL", "IRL", ["lagos", "walk"], 7_930, 6],
  ["Painting a six-foot canvas, start to finish", "Visual Art & Illustration", ["acrylic", "canvas"], 2_310, 7],
  ["Friday night set — house into amapiano", "Electronic & Dance", ["house", "set"], 9_410, 8],
  ["30-min HIIT — join in from home", "Fitness & Training", ["hiit", "home"], 2_760, 9],
  ["Memecoin roulette — you pick, I ape $50", "Memecoins & Degen", ["solana", "degen"], 8_902, 10],
  ["London open: DXY, gold and the crypto bid", "Crypto Markets", ["forex", "dxy"], 2_740, 11],
  ["BTC reclaiming 90k — live desk, open Q&A", "Crypto Markets", ["btc", "macro"], 12_483, 0],
  ["COD Mobile ranked with subs", "Mobile Gaming", ["codm", "subs"], 5_560, 12],
  ["Roasting your DMs — comedy hour", "Comedy & Memes", ["roast", "dms"], 6_040, 13],
  ["One Piece watch party — ep. 1100", "Anime & Manga", ["onepiece", "watchparty"], 3_870, 14],
  ["Detailing a G-Wagon in three hours", "Cars & Automotive", ["detailing", "gwagon"], 1_930, 15],
];

const HUES = [12, 198, 285, 42, 330, 160, 265, 95, 220, 8, 250, 175, 300, 130, 55, 20];

async function main() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);

  await Promise.all([
    db.collection("users").deleteMany({ authUserId: /^seed_/ }),
    db.collection("streams").deleteMany({}),
    db.collection("chatmessages").deleteMany({}),
    db.collection("watchsessions").deleteMany({}),
    db.collection("viewersamples").deleteMany({}),
    db.collection("streamreminders").deleteMany({}),
    db.collection("impressions").deleteMany({}),
    db.collection("follows").deleteMany({}),
    db.collection("gifttransactions").deleteMany({}),
    db.collection("battles").deleteMany({}),
    db.collection("games").deleteMany({}),
    db.collection("gameentries").deleteMany({}),
    db.collection("pointsledgers").deleteMany({}),
    db.collection("payouts").deleteMany({}),
    db.collection("auditlogs").deleteMany({}),
  ]);

  const now = Date.now();
  const clips = await fetchClips();

  // Real portraits for the streamers, so avatars aren't coloured initials.
  const avatars = await Promise.all(STREAMERS.map((_, i) => photo("portrait", i, 160, 160)));

  const users = STREAMERS.map(([username, displayName, bio, verified, followers], i) => ({
    authUserId: `seed_${username}`,
    email: `${username}@example.com`,
    username,
    displayName,
    avatar: avatars[i] ?? "",
    bio,
    followers,
    following: 20 + i * 7,
    totalViews: followers * 12,
    isLive: false,
    verified,
    streamKey: crypto.randomBytes(12).toString("hex"),
    earningsUsdMinor: followers * 3,
    settings: { autoRecord: false, slowMode: false, subscriberOnly: false, profanityFilter: true },
    createdAt: new Date(now - 86_400_000 * (200 - i * 9)),
    updatedAt: new Date(),
  }));

  const { insertedIds } = await db.collection("users").insertMany(users);
  const userIds = Object.values(insertedIds);

  // Velocity: where each stream was ten minutes ago, relative to now. A third
  // are climbing hard, a third flat, a third fading — so "trending" and
  // "popular" produce visibly different orderings.
  const growth = (i) => [0.3, 1.0, 1.2][i % 3];
  const score = (nowV, thenV) => Math.round(((nowV - thenV) / Math.max(thenV, 10)) * 1000) / 1000;

  // One real frame per live stream, matched to its subject.
  const liveThumbs = await Promise.all(
    STREAMS.map(([, category], i) => photo(topicFor(category), i, 800, 450)),
  );

  // Hand each live room a clip from its category's pool, round-robin, and
  // use that clip's own frame as the thumbnail.
  const poolCursor = {};
  const clipFor = (category) => {
    const pool = clips[clipPoolFor(category)] ?? [];
    if (pool.length === 0) return null;
    const n = poolCursor[clipPoolFor(category)] ?? 0;
    poolCursor[clipPoolFor(category)] = n + 1;
    return pool[n % pool.length];
  };

  const streams = STREAMS.map(([title, category, tags, viewers, streamerIdx], i) => {
    const startedAt = new Date(now - (12 + i * 17) * 60_000);
    const clip = clipFor(category);
    return {
      streamerId: userIds[streamerIdx],
      title,
      category,
      tags,
      thumbnail: clip?.frame ?? liveThumbs[i] ?? thumbnailPng(HUES[i % HUES.length]),
      thumbnailVersion: now,
      ...(clip ? { previewUrl: clip.url } : {}),
      status: "live",
      scheduledStartAt: null,
      velocity: score(viewers, Math.round(viewers * growth(i))),
      isLive: true,
      livekitRoomName: `seed-room-${i}-${crypto.randomBytes(3).toString("hex")}`,
      source: "camera",
      notifyFollowers: true,
      viewers,
      peakViewers: Math.round(viewers * 1.35),
      viewerSeconds: viewers * ((now - startedAt.getTime()) / 1000) * 0.8,
      viewerSampledAt: new Date(),
      likes: Math.round(viewers * 0.42),
      guests: [],
      pinnedMessage: null,
      startedAt,
      endedAt: null,
      socialsRelayPending: false,
      duration: "0:00",
      earnings: "$0",
      createdAt: startedAt,
      updatedAt: new Date(),
    };
  });

  // Category each streamer broadcasts in, for their history and schedule.
  const homeCategory = (streamerIdx) =>
    (STREAMS.find(([, , , , s]) => s === streamerIdx) ?? STREAMS[0])[1];

  // Past broadcasts, so channel pages have history instead of one live row.
  const PAST_TITLES = [
    "Weekly recap and what's next",
    "Q&A: everything you asked last stream",
    "Late session — chat picks everything",
    "Community night",
    "First look at the new setup",
    "Highlights from the weekend",
  ];
  const past = [];
  for (let streamerIdx = 0; streamerIdx < STREAMERS.length; streamerIdx++) {
    const count = 2 + (streamerIdx % 3);
    for (let n = 0; n < count; n++) {
      const endedAt = new Date(now - (n + 1) * 86_400_000 - streamerIdx * 3_600_000);
      const lengthMin = 45 + ((streamerIdx + n) % 7) * 22;
      const startedAt = new Date(endedAt.getTime() - lengthMin * 60_000);
      const peak = 400 + ((streamerIdx * 7 + n * 13) % 40) * 220;
      const h = Math.floor(lengthMin / 60);
      const m = lengthMin % 60;
      const category = homeCategory(streamerIdx);
      past.push({
        streamerId: userIds[streamerIdx],
        title: PAST_TITLES[(streamerIdx + n) % PAST_TITLES.length],
        category,
        tags: [],
        thumbnail:
          (await photo(topicFor(category), streamerIdx + n * 3, 800, 450)) ??
          thumbnailPng(HUES[(streamerIdx + n * 3) % HUES.length]),
        thumbnailVersion: now,
        status: "ended",
        scheduledStartAt: null,
        velocity: 0,
        isLive: false,
        livekitRoomName: `seed-past-${streamerIdx}-${n}-${crypto.randomBytes(3).toString("hex")}`,
        source: "camera",
        notifyFollowers: true,
        viewers: 0,
        peakViewers: peak,
        viewerSeconds: peak * lengthMin * 60 * 0.55,
        viewerSampledAt: endedAt,
        likes: Math.round(peak * 0.38),
        guests: [],
        pinnedMessage: null,
        startedAt,
        endedAt,
        socialsRelayPending: false,
        duration: h > 0 ? `${h}:${String(m).padStart(2, "0")}:00` : `${m}:00`,
        earnings: "$0",
        createdAt: startedAt,
        updatedAt: endedAt,
      });
    }
  }

  // Upcoming: scheduled broadcasts that haven't started — what "Starting
  // soon", the reminder button and the channel schedule render.
  const UPCOMING = [
    ["Saturday watchalong: the derby", "Football (Soccer)", 45, 2],
    ["Sunday amapiano set, rooftop edition", "Afrobeats & Amapiano", 130, 3],
    ["Suya night — cooking for 20 people", "Food & Cooking", 300, 5],
    ["Ranked grind, night session", "Video Games", 24 * 60, 1],
    ["Track day at Ibadan — IRL from the paddock", "Cars & Automotive", 3 * 24 * 60, 15],
    ["Fed decision live reaction", "Crypto Markets", 2 * 24 * 60, 0],
  ];
  const upcomingThumbs = await Promise.all(
    UPCOMING.map(([, category], i) => photo(topicFor(category), i + 4, 800, 450)),
  );
  const upcoming = UPCOMING.map(([title, category, minutesAhead, streamerIdx], i) => {
    const when = new Date(now + minutesAhead * 60_000);
    return {
      streamerId: userIds[streamerIdx],
      title,
      category,
      tags: [],
      thumbnail: upcomingThumbs[i] ?? thumbnailPng(HUES[(i * 5 + 2) % HUES.length]),
      thumbnailVersion: now,
      status: "upcoming",
      scheduledStartAt: when,
      velocity: 0,
      isLive: false,
      livekitRoomName: `upcoming-seed-${i}-${crypto.randomBytes(3).toString("hex")}`,
      source: "camera",
      notifyFollowers: true,
      viewers: 0,
      peakViewers: 0,
      viewerSeconds: 0,
      viewerSampledAt: null,
      likes: 0,
      guests: [],
      pinnedMessage: null,
      startedAt: when,
      endedAt: null,
      socialsRelayPending: false,
      duration: "0:00",
      earnings: "$0",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  const inserted = await db.collection("streams").insertMany([...streams, ...past, ...upcoming]);
  const streamIds = Object.values(inserted.insertedIds);
  const liveIds = streamIds.slice(0, streams.length);
  const pastIds = streamIds.slice(streams.length, streams.length + past.length);

  // Viewer samples from ten minutes ago, so the velocity sweep has a "then"
  // reading on its first pass instead of waiting ten minutes.
  const tenAgo = new Date(now - 10 * 60_000);
  await db.collection("viewersamples").insertMany(
    streams.map((s, i) => ({ streamId: liveIds[i], viewers: Math.round(s.viewers * growth(i)), at: tenAgo })),
  );

  // Mark the hosts of live streams live.
  const liveHostIds = [...new Set(streams.map((s) => String(s.streamerId)))];
  await db.collection("users").updateMany(
    { _id: { $in: liveHostIds.map((id) => new ObjectId(id)) } },
    { $set: { isLive: true } },
  );

  // Viewers with overlapping habits, so co-viewership has structure to find.
  // Clusters by taste, with a few cross-cluster wanderers so the rows
  // aren't sealed silos.
  const CLUSTERS = [
    [1, 12, 14],        // gaming + anime
    [2, 15, 9],         // football, cars, fitness
    [3, 8, 6],          // music, DJ, IRL
    [4, 13, 5, 7],      // chat, comedy, cooking, art
    [0, 10, 11],        // markets
  ];
  const viewers = [];
  for (let v = 0; v < 60; v++) {
    viewers.push({
      authUserId: `seed_viewer_${v}`,
      email: `viewer${v}@example.com`,
      username: `viewer_${v}`,
      displayName: `Viewer ${v}`,
      avatar: "",
      bio: "",
      followers: 0,
      following: 0,
      totalViews: 0,
      isLive: false,
      verified: false,
      streamKey: crypto.randomBytes(12).toString("hex"),
      earningsUsdMinor: 0,
      settings: { autoRecord: false, slowMode: false, subscriberOnly: false, profanityFilter: true, discoverableByTag: true },
      onboarding: { completedAt: null, categories: [] },
      createdAt: new Date(now - 86_400_000 * 30),
      updatedAt: new Date(),
    });
  }
  const { insertedIds: viewerIdsMap } = await db.collection("users").insertMany(viewers);
  const viewerIds = Object.values(viewerIdsMap);

  const streamsByStreamer = new Map();
  [...streams.map((s, i) => ({ s, id: liveIds[i] })), ...past.map((s, i) => ({ s, id: pastIds[i] }))]
    .forEach(({ s, id }) => {
      const k = String(s.streamerId);
      if (!streamsByStreamer.has(k)) streamsByStreamer.set(k, []);
      streamsByStreamer.get(k).push({ ...s, _id: id });
    });

  const sessions = [];
  const follows = [];
  viewerIds.forEach((vid, v) => {
    const cluster = CLUSTERS[v % CLUSTERS.length];
    const watch = [...cluster];
    if (v % 4 === 0) watch.push(CLUSTERS[(v + 1) % CLUSTERS.length][0]);
    watch.forEach((streamerIdx, w) => {
      const streamerId = userIds[streamerIdx];
      const owned = streamsByStreamer.get(String(streamerId)) ?? [];
      const count = Math.max(1, 3 - w + (v % 2));
      for (let n = 0; n < count && n < owned.length; n++) {
        const st = owned[(v + n) % owned.length];
        const joinedAt = new Date(now - (1 + ((v * 7 + n * 13) % 20)) * 86_400_000 * 0.9);
        sessions.push({
          userId: vid,
          streamId: st._id,
          streamerId,
          category: st.category,
          joinedAt,
          leftAt: st.isLive && n === 0 ? null : new Date(joinedAt.getTime() + (8 + ((v + n) % 50)) * 60_000),
        });
      }
      if (w < 2) follows.push({ followerId: vid, followingId: streamerId, createdAt: new Date(), updatedAt: new Date() });
    });
  });
  await db.collection("watchsessions").insertMany(sessions);
  await db.collection("follows").insertMany(follows);

  // A week of gifts, so the rail's leaderboard has a race in it: a few
  // whales, a long tail, spread across the live rooms. Amounts in cents.
  const GIFTS = [["Rose", "🌹", 100], ["Coffee", "☕", 300], ["Rocket", "🚀", 1500], ["Crown", "👑", 5000], ["Whale", "🐳", 25000]];
  const gifts = [];
  for (let n = 0; n < 140; n++) {
    const v = (n * 7 + (n % 5)) % viewerIds.length;
    const whale = v % 9 === 0;
    const [giftName, emoji, gross] = GIFTS[whale ? 3 + (n % 2) : n % 3];
    const st = streams[(n * 3 + v) % streams.length];
    const commission = Math.round(gross * 0.2);
    gifts.push({
      senderId: viewerIds[v],
      streamerId: st.streamerId,
      streamId: liveIds[streams.indexOf(st)],
      giftName,
      emoji,
      grossUsdMinor: gross,
      commissionUsdMinor: commission,
      netUsdMinor: gross - commission,
      walletChargeId: `seed-charge-${n}`,
      idempotencyKey: `seed-gift-${n}`,
      createdAt: new Date(now - ((n * 37) % (6 * 24 * 60)) * 60_000),
      updatedAt: new Date(),
    });
  }
  await db.collection("gifttransactions").insertMany(gifts);

  console.log(
    `seeded ${users.length} streamers, ${viewers.length} viewers, ${streams.length} live, ${past.length} past, ${upcoming.length} upcoming, ${sessions.length} watch sessions, ${follows.length} follows`,
  );
  const clipCount = Object.values(clips).reduce((n, p) => n + p.length, 0);
  const clipTotal = Object.values(CLIP_POOLS).reduce((n, p) => n + p.length, 0);
  console.log(`photos: ${downloaded} downloaded, ${cached} from cache (${CACHE}); clips: ${clipCount}/${clipTotal}`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
