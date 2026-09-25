import type { FilterCategory } from "@xtreme/contracts";

/**
 * The chat filter's built-in terms, by category (see filter.ts for how
 * they match: whole words, any case or accent, through repeated letters,
 * separators like "f.u.c.k" and look-alikes like "sh1t" or "$hit"; `*`
 * stands for the rest of a word).
 *
 * A starting set, not a finished one. The Pidgin, Yoruba, Hausa and Igbo
 * entries in particular need review by native speakers before launch —
 * words that are insults in one register are ordinary in another, which
 * is why the ambiguous ones are left out rather than risked: "shege" and
 * "aboki" (everyday slang and "friend"), "were" (English), "ewu" (isi ewu
 * is a dish), "yeye" (also "mother"), "nude" (a lipstick shade). Creators
 * add their own terms in Settings → Chat.
 */
export const TERMS: Record<Exclude<FilterCategory, "links" | "scams">, string[]> = {
  profanity: [
    "fuck*",
    "fck*",
    "fuk*",
    "motherfuck*",
    "shit",
    "shits",
    "shitty",
    "shithead*",
    "bullshit*",
    "bitch*",
    "bastard*",
    "asshole*",
    "arsehole*",
    "dickhead*",
    "cunt*",
    "wanker*",
    "twat*",
    "piss off",
    // Yoruba and Hausa curses
    "omo ale",
    "dan iska",
  ],
  insults: [
    "idiot*",
    "moron*",
    "imbecile*",
    "dumbass*",
    "stupid",
    "loser",
    "losers",
    "clown",
    // Pidgin
    "mumu",
    "mugu",
    "olodo",
    // Yoruba
    "werey",
    "oloshi",
    "didinrin",
    "olori buruku",
    "oloriburuku",
    // Hausa
    "wawa",
    "jaki",
    "mahaukaci",
    "banza",
    // Igbo
    "onye ara",
    "onye nzuzu",
    "ofeke",
    "anu ofia",
  ],
  slurs: [
    "nigger*",
    "nigga*",
    "faggot*",
    "fag",
    "fags",
    "retard*",
    "tranny*",
    "chink*",
    "spic",
    "spics",
    "kike*",
    "wetback*",
    "coon",
    "coons",
    "paki",
    "pakis",
    // Ethnic slur against Igbo people
    "nyamiri",
  ],
  sexual: [
    "porn*",
    "nudes",
    "send nudes",
    "onlyfans",
    "blowjob*",
    "blow job*",
    "handjob*",
    "dick pic*",
    "boobs",
    "tits",
    "pussy",
    "horny",
    "hookup",
    "sexting",
    "sex chat",
    "cumshot*",
    "xxx",
    "prostitute*",
    "ashawo",
    "ashewo",
    "ikebe",
  ],
};

/** Links, including the shorteners and chat-app invites scams lean on. */
export const LINK_PATTERNS: RegExp[] = [
  /(?:https?:\/\/|www\.)\S+/i,
  /\b(?:t\.me|wa\.me|bit\.ly|tinyurl\.com|discord\.gg|linktr\.ee)\/\S+/i,
  /\b[a-z0-9-]{2,}\.(?:com|net|org|io|xyz|gg|co|ng|app|me|ly|link|site|online|info|biz|tv|live|to|finance|exchange|top|club|vip|pro|shop|store|click|fun|cc|ru|cn)\b(?:\/\S*)?/i,
];

/**
 * Scams: wallet addresses (on a crypto platform the classic is "send to
 * 0x…"), phone numbers pushed into chat, and the phrases every
 * double-your-money pitch uses.
 */
export const SCAM_PATTERNS: RegExp[] = [
  // Wallet addresses: EVM, Bitcoin (bech32 and legacy), Tron, Solana-like base58.
  /\b0x[a-f0-9]{40}\b/i,
  /\bbc1[ac-hj-np-z02-9]{25,62}\b/i,
  /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,
  /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/,
  /\b(?=[1-9A-HJ-NP-Za-km-z]*\d)(?=[1-9A-HJ-NP-Za-km-z]*[A-Z])(?=[1-9A-HJ-NP-Za-km-z]*[a-z])[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
  // Nigerian mobile numbers (0803…, +234803…).
  /(?:\+?234|\b0)[789][01]\d{8}\b/,
  // The pitch.
  /\bdoubl(?:e|ing) (?:your|ur) (?:money|crypto|btc|eth|usdt|coins?|investment|funds)\b/i,
  /\b(?:guaranteed|assured|daily) (?:profits?|returns?|income)\b/i,
  /\b(?:dm|message|inbox|text|whatsapp|telegram|chat) me (?:for|to|on) (?:invest|earn|profit|signals?|trading|recover|forex)/i,
  /\b(?:account|investment|recovery|crypto|forex) (?:manager|expert|agent)\b/i,
  /\bsend (?:me )?\d+(?:\.\d+)? ?(?:btc|eth|usdt|usdc|sol|bnb|trx|doge)\b/i,
  /\b(?:seed phrase|private key|recovery phrase|secret phrase|mnemonic)\b/i,
  /\bconnect (?:your )?wallet\b/i,
];
