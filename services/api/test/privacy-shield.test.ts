import { describe, expect, it, vi } from "vitest";
import { BIP39_ENGLISH } from "../../../lib/bip39-english";
import {
  DEFAULT_DETECTORS,
  CARRY_MS,
  FindingTracker,
  HOLD_MS,
  NOTICE_TEXT,
  SHOW_ANYWAY_MS,
  clampRect,
  containRect,
  describeZone,
  isWalletQr,
  keyShape,
  matchBip39,
  rectFromCorners,
  scanScreen,
  type Detectors,
  type Finding,
  type OcrWord,
  type QrHit,
  type ScanInput,
} from "../../../lib/privacy-shield-detect";
import { changed, scanSize, signature, toGrey, toPgm } from "../../../lib/privacy-shield-ocr";
import {
  DEFAULT_SHIELD_SETTINGS,
  DETECTOR_LABELS,
  coverPlan,
  isHideKey,
  planKey,
  readShieldSettings,
  shareShieldedScreen,
  type ShareRoom,
} from "../../../lib/privacy-shield";

/**
 * The privacy shield's detectors (lib/privacy-shield-detect.ts — a web
 * module tested here, like lib/looks.ts). OCR is simulated: text is laid
 * out in rows the way Tesseract reports it, word boxes and all, so each
 * case reads like the screen it stands for. The same detectors were run
 * against real Tesseract output in headless Chrome.
 */

const W = 1600;
const H = 900;

type Line = string | { text: string; x?: number; size?: number };

/** Lines of text as OCR would report them: words, boxes, reading order. */
function page(lines: Line[], { size = 16, top = 40, left = 40, gap = 1.7, qr }: { size?: number; top?: number; left?: number; gap?: number; qr?: QrHit[] } = {}): ScanInput {
  const words: OcrWord[] = [];
  let y = top;
  for (const line of lines) {
    const l = typeof line === "string" ? { text: line } : line;
    const s = l.size ?? size;
    let x = l.x ?? left;
    for (const t of l.text.split(/\s+/).filter(Boolean)) {
      const w = t.length * s * 0.55;
      words.push({ text: t, x0: x, y0: y, x1: x + w, y1: y + s, confidence: 90 });
      x += w + s * 0.45;
    }
    y += s * gap;
  }
  return { width: W, height: H, words, qr };
}

/** A phrase shown as a numbered grid, `cols` across; `order` is how OCR hands the words back. */
function grid(phrase: string[], cols: number, order: "rows" | "columns", { left = 300, top = 200, size = 18 } = {}): ScanInput {
  const rows = Math.ceil(phrase.length / cols);
  const cell = (i: number) => ({ c: i % cols, r: Math.floor(i / cols) });
  const words: OcrWord[] = [];
  const at = (i: number) => {
    const { c, r } = cell(i);
    const x = left + c * 260;
    const y = top + r * size * 2.4;
    const num = `${i + 1}.`;
    const nw = num.length * size * 0.55;
    words.push({ text: num, x0: x, y0: y, x1: x + nw, y1: y + size });
    const ww = phrase[i].length * size * 0.55;
    words.push({ text: phrase[i], x0: x + nw + 10, y0: y, x1: x + nw + 10 + ww, y1: y + size });
  };
  if (order === "rows") phrase.forEach((_, i) => at(i));
  else for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (r * cols + c < phrase.length) at(r * cols + c);
  return { width: W, height: H, words };
}

/** Words placed where they sit on a screen: [text, x, y, size?] — for sidebars, buttons, headings side by side. */
function screen(...items: [string, number, number, number?][]): ScanInput {
  const words: OcrWord[] = [];
  for (const [text, x0, y, size = 16] of items) {
    let x = x0;
    for (const t of text.split(/\s+/).filter(Boolean)) {
      const w = t.length * size * 0.55;
      words.push({ text: t, x0: x, y0: y, x1: x + w, y1: y + size });
      x += w + size * 0.45;
    }
  }
  return { width: W, height: H, words };
}

const kinds = (fs: Finding[]) => fs.map((f) => f.kind).sort();
const only = (d: Partial<Detectors>): Detectors => ({ phrases: false, keys: false, qr: false, pages: false, balances: false, ...d });

/** Deterministic look-alike secrets — fictional, never funded. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const HEX = "0123456789abcdef";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const draw = (alphabet: string, n: number, seed: number) => {
  const r = rng(seed);
  let s = "";
  while (s.length < n) s += alphabet[Math.floor(r() * alphabet.length)];
  // Mixed enough to look like what it is.
  return s;
};
const hex64 = draw(HEX, 64, 7);
const hex64b = draw(HEX, 64, 8);
const solanaKey = draw(B58, 88, 9);
// Published BIP-39 test vectors: valid phrases no one should fund.
const PHRASE_12 = "scheme spot photo card baby mountain device kick cradle pact join borrow".split(" ");
const PHRASE_24 = "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold".split(" ");
// BIP-32 test vector 1's master key, and BIP-84's: published examples.
const XPRV = "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi";
const ZPRV = "zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5";
// The Bitcoin wiki's WIF examples.
const WIF_5 = "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ";
const WIF_K = "KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617";

/**
 * Tesseract's own read of the headless-Chrome check page (1600×900 copy of
 * a 1920×1080 fake wallet), word for word: a phrase grid with a sidebar
 * whose labels ("Swap", "Settings", "Help") land between the grid's rows,
 * and a 64-hex key read back 66 characters long with an "l" for a "1" and
 * an "o" for a "0" in places. [text, x0, y0, x1, y1].
 */
type Read = [string, number, number, number, number][];
const READ_PHRASE: Read = [
  ["Lumen",31,35,100,51], ["Wallet",107,35,170,51], ["Main",285,36,341,55], ["account",349,37,445,55], ["Home",31,102,77,114],
  ["Your",283,102,334,120], ["words",340,102,408,120], ["Assets",30,145,86,158], ["Keep",285,143,323,159], ["them",329,143,368,156],
  ["somewhere",374,143,463,156], ["safe",469,143,501,156], ["and",507,143,535,156], ["offline.",541,143,591,156],
  ["Activity",30,188,87,204], ["1",300,207,305,221], ["scheme",336,206,410,221], ["2",549,207,558,221], ["spot",586,207,627,224],
  ["photo",836,206,890,224], ["Swap",31,231,74,247], ["4",299,265,308,279], ["card",336,265,377,279], ["5.",549,265,563,279],
  ["baby",586,265,631,283], ["mountain",836,265,924,279], ["Settings",31,275,94,291], ["Help",31,318,66,334], ["7",299,324,308,337],
  ["device",336,323,397,338], ["8.",549,323,563,337], ["kick",586,323,624,338], ["cradle",836,323,894,338], ["10.",300,382,320,396],
  ["pact",336,382,377,399], ["11.",550,382,566,396], ["join",584,381,619,399], ["12",800,382,819,396], ["borrow",836,381,903,396],
  ["14:00:00",32,844,87,854], ["UTC",94,844,122,854],
];
const READ_KEY: Read = [
  ["Lumen",31,35,100,51], ["Wallet",107,35,170,51], ["Main",285,36,341,55], ["account",349,37,445,55], ["Home",31,102,77,114],
  ["Terminal",283,102,377,120], ["Assets",30,145,86,158], ["$",285,158,293,175], ["cat",307,159,337,173], ["notes.txt",351,159,447,173],
  ["Activity",30,188,87,204], ["61lead50df57cb1lbee15f0107c909713b2e4642d02019a41bbbfofc8ladc5feea",284,195,1052,210],
  ["Swap",31,231,74,247], ["$",285,232,293,248], ["Settings",31,275,94,291], ["Help",31,318,66,334], ["14:00:00",32,844,87,854],
  ["UTC",94,844,122,854],
];
const fromRead = (read: Read): ScanInput => ({ width: 1600, height: 900, words: read.map(([text, x0, y0, x1, y1]) => ({ text, x0, y0, x1, y1 })) });

describe("the wordlist", () => {
  it("is the 2048 BIP-39 English words, in order, each known by its first four letters", () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(BIP39_ENGLISH[0]).toBe("abandon");
    expect(BIP39_ENGLISH[2047]).toBe("zoo");
    expect(new Set(BIP39_ENGLISH.map((w) => w.slice(0, 4))).size).toBe(2048);
    expect([...BIP39_ENGLISH].sort()).toEqual(BIP39_ENGLISH);
  });

  it("knows a word as OCR might misread it — but not an ordinary one", () => {
    expect(matchBip39("abandon")).toBe("exact");
    expect(matchBip39("ABANDON")).toBe("exact");
    expect(matchBip39("aband0n")).toBe("fuzzy"); // a zero for an o
    expect(matchBip39("abandcn")).toBe("fuzzy"); // one letter wrong, at five letters and up
    expect(matchBip39("rnarble")).toBe("fuzzy"); // "rn" for "m"
    expect(matchBip39("the")).toBeNull();
    expect(matchBip39("wallet")).toBeNull();
    expect(matchBip39("markets")).toBeNull(); // a plural is a different length, not a misread
    expect(matchBip39("zcx")).toBeNull(); // short words have to be exact
  });
});

describe("recovery phrases", () => {
  it("hide the whole screen: a 12-word phrase on one line", () => {
    const found = scanScreen(page(["Your wallet", PHRASE_12.join(" "), "Copy to clipboard"]), only({ phrases: true }));
    expect(kinds(found)).toEqual(["phrase"]);
    expect(found[0].whole).toBe(true);
  });

  it("a numbered grid, read across or down", () => {
    for (const order of ["rows", "columns"] as const) {
      expect(kinds(scanScreen(grid(PHRASE_24, 3, order), only({ phrases: true }))), order).toEqual(["phrase"]);
      expect(kinds(scanScreen(grid(PHRASE_12, 2, order), only({ phrases: true }))), order).toEqual(["phrase"]);
    }
  });

  it("as Tesseract really read one, a sidebar's labels between its rows", () => {
    const found = scanScreen(fromRead(READ_PHRASE), DEFAULT_DETECTORS);
    expect(kinds(found)).toEqual(["phrase"]);
  });

  it("the box covers the phrase", () => {
    const [f] = scanScreen(grid(PHRASE_12, 3, "rows"), only({ phrases: true }));
    // The grid runs from x=300 and y=200 in a 1600×900 frame.
    expect(f.rect.x).toBeLessThan(300 / W);
    expect(f.rect.y).toBeLessThan(200 / H);
    expect(f.rect.x + f.rect.w).toBeGreaterThan((300 + 2 * 260 + 60) / W);
  });

  it("survive OCR slop: misread letters, run-together words, a garbled word", () => {
    // scheme spot photo card baby mountain device kick cradle pact join borrow
    const slop = ["scheme", "sp0t", "photo", "card", "baby", "rnountain", "devlce", "kickcradle", "p#ct", "join", "borrow"];
    // sp0t: a zero for an o. rnountain: "rn" for "m". devlce: one letter wrong. kickcradle: two words, no space. p#ct: past reading.
    expect(kinds(scanScreen(page([slop.join(" ")]), only({ phrases: true })))).toEqual(["phrase"]);
  });

  it("in quotes, or given to a name, on one line", () => {
    const P = PHRASE_12.join(" ");
    for (const line of [`MNEMONIC="${P}"`, `const mnemonic = "${P}";`, `"${P}"`, `'${P}',`, `export WALLET_WORDS='${P}'`, `{ "mnemonic": "${P}" }`, `seed: ${P}`]) {
      expect(kinds(scanScreen(page([line]), only({ phrases: true }))), line.slice(0, 24)).toEqual(["phrase"]);
    }
  });

  it("after a label, or at the end of a chat line", () => {
    expect(kinds(scanScreen(page([`Mnemonic: ${PHRASE_12.join(" ")}`]), only({ phrases: true })))).toEqual(["phrase"]);
    expect(kinds(scanScreen(page([`ok so my backup is ${PHRASE_12.join(" ")}`]), only({ phrases: true })))).toEqual(["phrase"]);
  });

  it("any phrase a wallet could make — five hundred at random, on a line and in a grid", () => {
    const r = rng(2026);
    let missed = 0;
    for (let n = 0; n < 500; n++) {
      const words = Array.from({ length: n % 2 ? 24 : 12 }, () => BIP39_ENGLISH[Math.floor(r() * 2048)]);
      if (!scanScreen(page([words.slice(0, 12).join(" "), words.slice(12).join(" ")]), only({ phrases: true })).length) missed++;
      if (!scanScreen(grid(words, 3, n % 3 ? "rows" : "columns"), only({ phrases: true })).length) missed++;
    }
    expect(missed).toBe(0);
  });

  it("need eight words: seven isn't a phrase", () => {
    expect(scanScreen(page([PHRASE_12.slice(0, 7).join(" ")]), only({ phrases: true }))).toEqual([]);
    expect(kinds(scanScreen(page([PHRASE_12.slice(0, 8).join(" ")]), only({ phrases: true })))).toEqual(["phrase"]);
  });

  it("aren't ordinary English that happens to use the list's words", () => {
    const paragraph = [
      "The market opened higher this morning as traders weighed the latest inflation report.",
      "Bitcoin rose above its recent range while ether lagged behind, and analysts said the move",
      "could fade if volume stays thin. You will want to watch the dollar and the bond market over",
      "the next few days, because a strong report can change the mood of every desk in the city.",
    ];
    expect(scanScreen(page(paragraph), DEFAULT_DETECTORS)).toEqual([]);
    // A lyric sheet dense with list words.
    expect(scanScreen(page(["you can find the way home when the light is gone we will stand together in the rain"]), DEFAULT_DETECTORS)).toEqual([]);
  });

  it("aren't a menu of Title Case labels that happen to be list words", () => {
    const menu = "Home Market Trade Earn Swap Bridge Receive Sell Account Security History Spot Margin Grid Copy Help";
    expect(scanScreen(page([menu]), only({ phrases: true }))).toEqual([]);
  });

  it("aren't a typing test: a thousand screens of monkeytype's 200 commonest words", () => {
    const words200 =
      "the be of and a to in he have it that for they i with as not on she at by this we you do but from or which one would all will there say who make when can more if no man out other so what time up go about than into could state only new year some take come these know see use get like then first any work now may such give over think most even find day also after way many must look before great back through long where much should well people down own just because good each those feel seem how high too place little world very still nation hand old life tell write become here show house both between need mean call develop under last right move thing general school never same another begin while number part turn real leave might want point form off child few small since against ask late home interest large person end open public follow during present without again hold govern around possible head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line".split(
        " "
      );
    const r = rng(56);
    let slated = 0;
    for (let n = 0; n < 1000; n++) {
      const lines = Array.from({ length: 3 }, () => Array.from({ length: 13 }, () => words200[Math.floor(r() * words200.length)]).join(" "));
      if (scanScreen(page(lines, { size: 28 }), DEFAULT_DETECTORS).some((f) => f.whole)) slated++;
    }
    expect(slated).toBe(0);
  });

  it("aren't code, a log that repeats itself, or list words in the middle of a sentence", () => {
    expect(scanScreen(page(['{ "type": "Error", "message": "outer error", "stack": "Error: inner error", "code": "ERR_BAD" }']), only({ phrases: true }))).toEqual([]);
    expect(scanScreen(page(["retry error retry error retry error retry error retry error"]), only({ phrases: true }))).toEqual([]);
    expect(scanScreen(page(["so we said scheme spot photo card baby mountain device kick cradle to them and left"]), only({ phrases: true }))).toEqual([]);
  });
});

describe("private keys", () => {
  it("cover a bare 64-hex key, with a label or without", () => {
    const labelled = scanScreen(page(["Private key", hex64]), only({ keys: true }));
    expect(kinds(labelled)).toEqual(["private-key"]);
    expect(labelled[0].whole).toBe(false);
    expect(kinds(scanScreen(page(["notes.txt", hex64]), only({ keys: true })))).toEqual(["private-key"]);
  });

  it("cover a key as Tesseract really read it: two characters too many, look-alikes in it", () => {
    const found = scanScreen(fromRead(READ_KEY), DEFAULT_DETECTORS);
    expect(kinds(found)).toEqual(["private-key"]);
  });

  it("cover WIF keys and Solana-style base58 keys", () => {
    expect(kinds(scanScreen(page([`key ${WIF_5}`]), only({ keys: true })))).toEqual(["private-key"]);
    expect(kinds(scanScreen(page([WIF_K]), only({ keys: true })))).toEqual(["private-key"]);
    expect(kinds(scanScreen(page([solanaKey]), only({ keys: true })))).toEqual(["private-key"]);
  });

  it("cover a Solana keypair file's byte array", () => {
    const bytes = Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256);
    const found = scanScreen(page([`[${bytes.slice(0, 32).join(",")},`, `${bytes.slice(32).join(",")}]`]), only({ keys: true }));
    expect(kinds(found)).toEqual(["private-key"]);
  });

  it("cover a key broken over two lines, both lines", () => {
    const found = scanScreen(page(["Private key", hex64.slice(0, 40), hex64.slice(40)]), only({ keys: true }));
    expect(kinds(found)).toEqual(["private-key"]);
    // Two text lines tall, not one.
    expect(found[0].rect.h * H).toBeGreaterThan(16 * 2);
  });

  it("cover a key shown in groups of four", () => {
    const grouped = hex64.match(/.{4}/g)!.join(" ");
    expect(kinds(scanScreen(page([grouped]), only({ keys: true })))).toEqual(["private-key"]);
  });

  it("cover two keys on neighbouring lines as two boxes", () => {
    const found = scanScreen(page([hex64, hex64b], { gap: 1.25 }), only({ keys: true }));
    expect(found).toHaveLength(2);
  });

  it("cover .env assignments, 0x or not", () => {
    expect(kinds(scanScreen(page([`PRIVATE_KEY=0x${hex64}`]), only({ keys: true })))).toEqual(["private-key"]);
    expect(kinds(scanScreen(page([`Private key: 0x${hex64}`]), only({ keys: true })))).toEqual(["private-key"]);
  });

  it("leave public data alone: a 0x transaction hash, a Bitcoin txid, a Solana signature, an address", () => {
    // An explorer: public, and what a streamer walks viewers through.
    expect(scanScreen(page(["Transaction Hash:", `0x${hex64}`, "Status: Success", "Block: 20918311"]), only({ keys: true }))).toEqual([]);
    // 0x + 64 hex with nothing beside it is a hash (or an Aptos/Sui address) until the words say otherwise.
    expect(scanScreen(page([`0x${hex64}`]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page(["Transaction", hex64, "Confirmed"]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page([`mempool.space/tx/${hex64}`]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page(["Signature", solanaKey]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page(["Address 0x52908400098527886E0F7030069857D2E4169EE7"]), only({ keys: true }))).toEqual([]);
  });

  it("read snake_case labels: ETH_PRIVKEY=, WALLET_SEED=", () => {
    expect(kinds(scanScreen(page([`ETH_PRIVKEY=0x${hex64}`]), only({ keys: true })))).toEqual(["private-key"]);
    expect(kinds(scanScreen(page([`WALLET_SEED=0x${hex64}`]), only({ keys: true })))).toEqual(["private-key"]);
    // "priv" inside "privacy" is no label.
    expect(scanScreen(page([`privacy_policy_hash=0x${hex64}`]), only({ keys: true }))).toEqual([]);
  });

  it("leave checksums, digests and an explorer's padded words alone", () => {
    const padded = "000000000000000000000000" + hex64.slice(0, 40); // an address as input or log data
    expect(scanScreen(page(["Input Data", `[0]: ${padded}`, `[1]: 0000000000000000000000000000000000000000000000000de0b6b3a7640000`]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page(["$ shasum -a 256 wallet-app.dmg", `${hex64}  wallet-app.dmg`]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page([`Digest: sha256:${hex64}`]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page([`sha256:${hex64}`]), only({ keys: true }))).toEqual([]);
    expect(scanScreen(page(["Checksum", hex64]), only({ keys: true }))).toEqual([]);
    // Labelled a key, twelve zeros or not, it's covered.
    expect(kinds(scanScreen(page(["Private key", padded]), only({ keys: true })))).toEqual(["private-key"]);
  });

  it("keyShape tells the shapes apart", () => {
    expect(keyShape(hex64).kind).toBe("private-key");
    expect(keyShape(`0x${hex64}`).kind).toBe("tx-hash");
    expect(keyShape(WIF_5).kind).toBe("private-key");
    expect(keyShape(XPRV).kind).toBe("extended-key");
    expect(keyShape("0x52908400098527886E0F7030069857D2E4169EE7").kind).toBeNull();
    expect(keyShape("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").kind).toBeNull();
    expect(keyShape(`03${hex64}`).kind).toBeNull(); // a compressed public key
    // OCR put an O for a zero and an l for a one: still a key.
    expect(keyShape(hex64.replace("0", "O").replace("1", "l")).kind).toBe("private-key");
  });
});

describe("extended private keys", () => {
  it("cover xprv and zprv keys", () => {
    expect(kinds(scanScreen(page([XPRV]), only({ keys: true })))).toEqual(["extended-key"]);
    expect(kinds(scanScreen(page([`Account key ${ZPRV}`]), only({ keys: true })))).toEqual(["extended-key"]);
  });

  it("cover all of one broken over three lines", () => {
    const found = scanScreen(page([XPRV.slice(0, 40), XPRV.slice(40, 80), XPRV.slice(80)]), only({ keys: true }));
    expect(kinds(found)).toEqual(["extended-key"]);
    expect(found[0].rect.h * H).toBeGreaterThan(16 * 3);
  });

  it("leave an xpub alone", () => {
    expect(scanScreen(page([XPRV.replace("xprv", "xpub")]), only({ keys: true }))).toEqual([]);
  });
});

describe("key export pages", () => {
  const pages = only({ pages: true });

  it("hide the whole screen when the reveal is a heading or a button of its own", () => {
    for (const heading of ["Reveal Secret Recovery Phrase", "Export private key", "Show private key", "View recovery phrase", "Reveal your seed phrase"]) {
      const found = scanScreen(page([{ text: heading, size: 26 }, "Make sure nobody is looking at your screen."]), pages);
      expect(kinds(found), heading).toEqual(["key-page"]);
      expect(found[0].whole).toBe(true);
    }
    // A button, alone on its row.
    expect(kinds(scanScreen(screen(["Settings", 40, 60], ["Security", 40, 100], ["Export private key", 400, 300]), pages))).toEqual(["key-page"]);
  });

  it("a heading with a Reveal, Show or Export button by it, or a key under it", () => {
    expect(kinds(scanScreen(page([{ text: "Secret Recovery Phrase", size: 26 }, "Make sure nobody is looking at your screen.", "", "Reveal"]), pages))).toEqual(["key-page"]);
    expect(kinds(scanScreen(page(["Seed phrase", "", "Reveal"]), pages))).toEqual(["key-page"]);
    expect(kinds(scanScreen(screen(["Private key", 400, 200, 22], ["Show", 400, 300]), pages))).toEqual(["key-page"]);
    expect(kinds(scanScreen(page([{ text: "Your Private Key", size: 24 }, hex64]), only({ pages: true, keys: true })))).toEqual(["key-page", "private-key"]);
  });

  it("a blurred phrase's own prompt: Tap to reveal your recovery phrase — and a four-word button", () => {
    expect(kinds(scanScreen(screen(["Tap to reveal your recovery phrase", 500, 300]), pages))).toEqual(["key-page"]);
    expect(kinds(scanScreen(screen(["Seed phrase", 400, 200, 22], ["Hold to reveal SRP", 400, 320]), pages))).toEqual(["key-page"]);
  });

  it("read through OCR slop", () => {
    expect(kinds(scanScreen(page([{ text: "Reveal Secret Recovcry Phrase", size: 26 }]), pages))).toEqual(["key-page"]);
  });

  it("aren't a warning in a sentence, or a title with nothing to reveal", () => {
    expect(scanScreen(page(["Never share your seed phrase with anyone. Scammers will ask for it in DMs, and support never will."]), pages)).toEqual([]);
    expect(scanScreen(page(["Private key", "", "Learn how wallets keep them safe"]), pages)).toEqual([]);
    // A docs heading on its own is a docs heading.
    expect(scanScreen(page([{ text: "Secret Recovery Phrase", size: 26 }, "A Secret Recovery Phrase is the master key to a wallet."]), pages)).toEqual([]);
  });

  it("aren't a docs sidebar, a code block's Copy, a cloud console, or a wallet's backup reminder", () => {
    // Docs: "Seed phrase" in the sidebar, View on GitHub (and Show more) elsewhere.
    const docs = screen(
      ["Wallets", 40, 100],
      ["Seed phrase", 40, 140],
      ["Hardware", 40, 180],
      ["Show more", 40, 220],
      ["How wallets derive addresses", 400, 100, 26],
      ["View on GitHub", 1200, 100],
      ["Every address comes from the same root, which is why losing it loses everything.", 400, 160]
    );
    expect(scanScreen(docs, pages)).toEqual([]);
    // A "Private key" heading with a Copy button on its code block.
    expect(scanScreen(screen(["Private key", 400, 100, 26], ["Copy", 1100, 160], ["const key = loadFromVault();", 420, 170]), pages)).toEqual([]);
    // A cloud console's key pair form.
    expect(scanScreen(screen(["Private key file format", 400, 100, 22], ["PEM", 420, 150], ["PPK", 520, 150], ["View details", 400, 220]), pages)).toEqual([]);
    // A wallet's banner, and its button.
    expect(scanScreen(screen(["Back up your recovery phrase", 400, 100, 20], ["Back up now", 400, 150]), pages)).toEqual([]);
    // Someone typing it in chat, name first.
    expect(scanScreen(screen(["fan123: Export private key", 1300, 700]), pages)).toEqual([]);
  });

  it("never take the shield's own panel for one — the studio can be in the capture", () => {
    const rows: [string, number, number, number?][] = [["Privacy shield", 1300, 60], ["Hide my screen", 1300, 100]];
    let y = 140;
    for (const n of Object.values(NOTICE_TEXT)) rows.push([n, 1300, (y += 40)], ["Keep hidden", 1300, (y += 30)], ["Show anyway for 10 s", 1420, y]);
    for (const d of DETECTOR_LABELS) rows.push([d.label, 1300, (y += 40)], [d.hint, 1300, (y += 24)]);
    expect(scanScreen(screen(...rows), DEFAULT_DETECTORS)).toEqual([]);
  });
});

describe("wallet QR codes", () => {
  it("are payment requests, addresses, keys and SeedQRs — not links", () => {
    expect(isWalletQr("bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001")).toBe(true);
    expect(isWalletQr("ethereum:0x52908400098527886E0F7030069857D2E4169EE7@1")).toBe(true);
    expect(isWalletQr("solana:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe(true);
    expect(isWalletQr("0x52908400098527886E0F7030069857D2E4169EE7")).toBe(true);
    expect(isWalletQr("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toBe(true);
    expect(isWalletQr(WIF_K)).toBe(true);
    expect(isWalletQr("0".repeat(4) + "1234".repeat(11))).toBe(true); // a 12-word SeedQR
    expect(isWalletQr(PHRASE_12.join(" "))).toBe(true);
    expect(isWalletQr("https://xtream.live/c/amara")).toBe(false);
    expect(isWalletQr("WIFI:S:Studio;T:WPA;P:hunter2;;")).toBe(false);
  });

  it("get a box where the detector found them", () => {
    const qr: QrHit[] = [
      { rawValue: "bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", x0: 1200, y0: 300, x1: 1400, y1: 500 },
      { rawValue: "https://xtream.live/c/amara", x0: 100, y0: 600, x1: 250, y1: 750 },
    ];
    const found = scanScreen(page(["Receive"], { qr }), only({ qr: true }));
    expect(kinds(found)).toEqual(["wallet-qr"]);
    expect(found[0].rect.x).toBeLessThan(1200 / W);
    expect(found[0].rect.x + found[0].rect.w).toBeGreaterThan(1400 / W);
    expect(scanScreen(page(["Receive"], { qr }), only({}))).toEqual([]);
  });
});

describe("balances", () => {
  const wallet = ["Total balance", "$12,480.55", "", "Assets", "Bitcoin 0.4210 BTC $27,301.20", "Solana 18.5 SOL $2,811.10"];
  const chart = [
    "BTC/USDT 64,213.50 +2.31%",
    "Markets Watchlist",
    "BTC 64,213.50 +2.31%",
    "ETH 3,412.20 -1.20%",
    "SOL 151.04 +4.02%",
    "65,000.00",
    "64,500.00",
    "64,000.00",
    "Order book Price(USDT) Amount(BTC)",
    "64,210.1 0.532 34,123.4",
  ];

  it("are left alone unless asked", () => {
    expect(scanScreen(page(wallet), DEFAULT_DETECTORS)).toEqual([]);
    expect(scanScreen(page(chart), DEFAULT_DETECTORS)).toEqual([]);
  });

  it("when asked, cover an amount beside a ticker or currency sign on a wallet screen", () => {
    const found = scanScreen(page(wallet), only({ balances: true }));
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every((f) => f.kind === "balance")).toBe(true);
  });

  it("when asked, still leave a chart's prices alone", () => {
    expect(scanScreen(page(chart), only({ balances: true }))).toEqual([]);
  });
});

describe("holding what was found", () => {
  const key: Finding = { kind: "private-key", rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.04 }, whole: false };
  const phrase: Finding = { kind: "phrase", rect: { x: 0.2, y: 0.3, w: 0.5, h: 0.3 }, whole: true };

  it("covers a find until reads have gone 8 seconds without it", () => {
    const t = new FindingTracker();
    expect(t.update([key], 0)).toHaveLength(1);
    expect(t.cover(1000).rects).toHaveLength(1);
    t.update([], 1000); // a read that missed it
    t.update([], HOLD_MS);
    expect(t.cover(HOLD_MS).rects).toHaveLength(1);
    t.update([], HOLD_MS + 1);
    expect(t.cover(HOLD_MS + 1).rects).toHaveLength(0);
  });

  it("holds through a still screen that sends no frames: no reads, nothing lapses", () => {
    const t = new FindingTracker();
    t.update([key], 0);
    // A minute with no frames — so no reads — then a scroll: the first frame is still covered.
    expect(t.cover(60_000).rects).toHaveLength(1);
  });

  it("knows a find seen again in the same place, and a new one elsewhere", () => {
    const t = new FindingTracker();
    const [a] = t.update([key], 0);
    expect(t.update([{ ...key, rect: { ...key.rect, x: 0.11 } }], 1000)).toHaveLength(0);
    const [b] = t.update([{ ...key, rect: { ...key.rect, y: 0.7 } }], 2000);
    expect(b.id).not.toBe(a.id);
    expect(t.cover(2000).rects).toHaveLength(2);
  });

  it("keeps covering what a still screen showed, and lets go of what left it", () => {
    const t = new FindingTracker();
    t.update([key], 0);
    t.update([phrase], 1000); // the key scrolled away; a phrase came up
    for (let now = 2000; now <= 20_000; now += 1000) t.touch(now);
    const c = t.cover(20_000);
    expect(c.whole).toBe(true);
    expect(c.rects).toHaveLength(0);
  });

  it("doesn't age text finds on QR-only reads — the text read being down isn't the phrase going away", () => {
    const t = new FindingTracker();
    t.update([phrase], 0);
    for (let now = 1000; now <= 30_000; now += 1000) t.update([], now, { text: false, qr: true });
    expect(t.cover(30_000).whole).toBe(true);
    // Text reads back: now it ages.
    t.update([], 31_000);
    t.update([], 31_000 + HOLD_MS + 1);
    expect(t.cover(31_000 + HOLD_MS + 1).whole).toBe(false);
  });

  it("carries a share's finds to the next — a re-share or a rejoin — for its first reads to confirm", () => {
    const first = new FindingTracker();
    first.update([phrase, key], 0);
    const carried = first.carry();
    // The next share, twenty seconds on: covered before it has read anything.
    const next = new FindingTracker();
    next.seed(carried, 20_000);
    expect(next.cover(20_000)).toEqual({ whole: true, rects: [key.rect] });
    // One read that misses them isn't enough; the hold's worth of reads is.
    next.update([], 21_000);
    expect(next.cover(21_000).whole).toBe(true);
    next.update([], 20_000 + HOLD_MS + 1);
    expect(next.cover(20_000 + HOLD_MS + 1)).toEqual({ whole: false, rects: [] });
    // Too long ago, and it doesn't carry.
    const late = new FindingTracker();
    late.seed(carried, CARRY_MS + 1);
    expect(late.held).toHaveLength(0);
    // Seen again, it's the same find, not two.
    next.seed(carried, 25_000);
    next.seed(carried, 25_000);
    expect(next.held.filter((h) => h.kind === "phrase")).toHaveLength(1);
  });

  it("slates once for a page, however many headings say so", () => {
    const t = new FindingTracker();
    const page: Finding = { kind: "key-page", rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 }, whole: true };
    const fresh = t.update([page, { ...page, rect: { x: 0.1, y: 0.5, w: 0.2, h: 0.05 } }], 0);
    expect(fresh).toHaveLength(1);
    expect(t.cover(0).whole).toBe(true);
  });

  it("shows anyway for 10 seconds, then covers again if it's still there", () => {
    const t = new FindingTracker();
    const [h] = t.update([phrase], 0);
    expect(t.showAnyway(h.id, 500)).toBe(true);
    expect(t.cover(1000).whole).toBe(false);
    t.update([phrase], 2000);
    expect(t.cover(500 + SHOW_ANYWAY_MS - 1).whole).toBe(false);
    t.update([phrase], 500 + SHOW_ANYWAY_MS);
    expect(t.cover(500 + SHOW_ANYWAY_MS).whole).toBe(true);
  });

  it("keeps hidden, and forgets a detector's finds when it's switched off", () => {
    const t = new FindingTracker();
    const [h] = t.update([key, phrase], 0);
    expect(t.keep(h.id)).toBe(true);
    expect(t.held.find((x) => x.id === h.id)?.kept).toBe(true);
    t.drop(["private-key"]);
    expect(t.cover(0)).toEqual({ whole: true, rects: [] });
  });
});

describe("zones", () => {
  it("stay inside the frame and big enough to see", () => {
    expect(clampRect({ x: 0.9, y: -0.2, w: 0.3, h: 0.001 })).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.02 });
    expect(clampRect({ x: Number.NaN, y: 0.5, w: 2, h: 0.5 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it("come from two corners either way round", () => {
    expect(rectFromCorners(0.6, 0.5, 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.6 - 0.2, h: 0.5 - 0.1 });
  });

  it("sit over the picture, not its letterbox", () => {
    // A 16:9 screen in a square box: bars top and bottom.
    expect(containRect(900, 900, 16 / 9)).toEqual({ x: 0, y: (900 - 506.25) / 2, w: 900, h: 506.25 });
    // A 4:3 window in a 16:9 box: bars left and right.
    expect(containRect(1600, 900, 4 / 3)).toEqual({ x: 200, y: 0, w: 1200, h: 900 });
  });

  it("describe themselves", () => {
    expect(describeZone({ x: 0.7, y: 0.02, w: 0.24, h: 0.12 })).toBe("top right, 24% × 12%");
    expect(describeZone({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })).toBe("centre, 20% × 20%");
  });
});

describe("the settings", () => {
  it("fall back to the defaults for anything unknown: the checks on, balances off, no zones", () => {
    expect(readShieldSettings(null)).toEqual(DEFAULT_SHIELD_SETTINGS);
    expect(readShieldSettings("not json")).toEqual(DEFAULT_SHIELD_SETTINGS);
    expect(DEFAULT_SHIELD_SETTINGS.detectors).toEqual({ phrases: true, keys: true, qr: true, pages: true, balances: false });
    const r = readShieldSettings({ enabled: "yes", detectors: { balances: true, keys: 0 } });
    expect(r.enabled).toBe(true);
    expect(r.detectors).toEqual({ phrases: true, keys: true, qr: true, pages: true, balances: true });
  });

  it("keep zones inside the frame, drop broken ones, and cap how many", () => {
    const raw = JSON.stringify({
      enabled: false,
      zones: [
        { id: "a", x: 0.9, y: 0.9, w: 0.5, h: 0.5 },
        { id: "b", x: "left", y: 0, w: 0.1, h: 0.1 },
        ...Array.from({ length: 20 }, (_, i) => ({ id: `z${i}`, x: 0.01 * i, y: 0, w: 0.1, h: 0.1 })),
      ],
    });
    const r = readShieldSettings(raw);
    expect(r.enabled).toBe(false);
    expect(r.zones[0]).toEqual({ id: "a", x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(r.zones.find((z) => z.id === "b")).toBeUndefined();
    expect(r.zones.length).toBeLessThanOrEqual(12);
  });
});

describe("frames for reading", () => {
  it("are at most 1600 wide, the shape kept", () => {
    expect(scanSize(1920, 1080)).toEqual({ width: 1600, height: 900 });
    expect(scanSize(3840, 2160)).toEqual({ width: 1600, height: 900 });
    expect(scanSize(1280, 800)).toEqual({ width: 1280, height: 800 });
    expect(scanSize(0, 100)).toEqual({ width: 0, height: 0 });
  });

  it("go grey, then into a PGM Tesseract reads as it is", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
    const grey = toGrey(rgba, 2, 2);
    expect([...grey]).toEqual([255, 0, 76, 28]);
    const pgm = toPgm(grey, 2, 2);
    expect(new TextDecoder().decode(pgm.subarray(0, 11))).toBe("P5\n2 2\n255\n");
    expect([...pgm.subarray(11)]).toEqual([255, 0, 76, 28]);
  });

  it("tell a still screen from one where a line of text appeared", () => {
    const w = 320;
    const h = 180;
    const blank = new Uint8Array(w * h).fill(240);
    const typed = blank.slice();
    // A line of dark text, 200 × 8 px.
    for (let y = 60; y < 68; y++) for (let x = 40; x < 240; x += 2) typed[y * w + x] = 20;
    const a = signature(blank, w, h);
    expect(changed(a, signature(blank.slice(), w, h))).toBe(false);
    expect(changed(a, signature(typed, w, h))).toBe(true);
    expect(changed(null, a)).toBe(true);
  });
});

describe("what a frame wears", () => {
  const zone = { id: "z1", x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
  const cover = { whole: false, rects: [{ x: 0.5, y: 0.5, w: 0.2, h: 0.05 }] };
  const on = { ...DEFAULT_SHIELD_SETTINGS, zones: [zone] };

  it("covers the zones with the Shield switch off — they're the host's own choice", () => {
    const off = { ...on, enabled: false };
    expect(coverPlan({ panic: false, settings: off, cover, checking: false })).toEqual({ slate: null, rects: [zone] });
    expect(coverPlan({ panic: false, settings: off, cover: { whole: true, rects: [] }, checking: true })).toEqual({ slate: null, rects: [zone] });
    expect(coverPlan({ panic: false, settings: { ...off, zones: [] }, cover, checking: false })).toBeNull();
  });

  it("puts Hide first, then a whole-screen find, then the start's slate, then the boxes", () => {
    expect(coverPlan({ panic: true, settings: on, cover: { whole: true, rects: [] }, checking: true })).toEqual({ slate: "panic" });
    expect(coverPlan({ panic: false, settings: on, cover: { whole: true, rects: [] }, checking: true })).toEqual({ slate: "secret" });
    expect(coverPlan({ panic: false, settings: on, cover, checking: true })).toEqual({ slate: "checking" });
    expect(coverPlan({ panic: false, settings: on, cover, checking: false })).toEqual({ slate: null, rects: [zone, ...cover.rects] });
  });

  it("tells plans apart, so a change goes out at once", () => {
    const a = coverPlan({ panic: false, settings: on, cover, checking: false });
    const b = coverPlan({ panic: false, settings: on, cover: { whole: false, rects: [] }, checking: false });
    expect(planKey(a)).not.toBe(planKey(b));
    expect(planKey(null)).toBe("clear");
    expect(planKey({ slate: "panic" })).toBe("slate:panic");
  });
});

describe("the Hide key", () => {
  const target = (el: { tag?: string; editable?: boolean; inside?: string[] } = {}) => ({
    tagName: el.tag ?? "DIV",
    isContentEditable: Boolean(el.editable),
    closest: (selector: string) => (el.inside ?? []).some((role) => selector.includes(role)) || (el.tag && selector.includes(el.tag.toLowerCase())) ? {} : null,
  });

  it("is H on its own, not typed, not handled already", () => {
    expect(isHideKey({ key: "h", target: target() })).toBe(true);
    expect(isHideKey({ key: "H", target: target() })).toBe(true);
    expect(isHideKey({ key: "g", target: target() })).toBe(false);
    expect(isHideKey({ key: "h", metaKey: true, target: target() })).toBe(false);
    expect(isHideKey({ key: "h", repeat: true, target: target() })).toBe(false);
    expect(isHideKey({ key: "h", defaultPrevented: true, target: target() })).toBe(false);
  });

  it("survives Chrome's autofill keydown, which has no key at all", () => {
    expect(isHideKey({ target: target() })).toBe(false);
    expect(isHideKey({ key: undefined, target: target() })).toBe(false);
  });

  it("stays out of text fields and a menu's or a list's type-to-find", () => {
    expect(isHideKey({ key: "h", target: target({ tag: "INPUT" }) })).toBe(false);
    expect(isHideKey({ key: "h", target: target({ tag: "TEXTAREA" }) })).toBe(false);
    expect(isHideKey({ key: "h", target: target({ editable: true }) })).toBe(false);
    expect(isHideKey({ key: "h", target: target({ inside: ['role="listbox"'] }) })).toBe(false);
    expect(isHideKey({ key: "h", target: target({ inside: ['role="menu"'] }) })).toBe(false);
    expect(isHideKey({ key: "h", target: target({ inside: ['role="combobox"'] }) })).toBe(false);
  });
});

describe("sharing a screen with the shield on it", () => {
  /** A LiveKit room, as far as a share goes: tracks made, published and taken down, on demand. */
  function fakeRoom({ existing = false } = {}) {
    const calls = { create: 0, publish: 0, unpublish: 0, unmute: 0 };
    let raw = { readyState: "live" as "live" | "ended" };
    let pickerOpen: (() => void) | null = null;
    const video = () => ({ kind: "video", mediaStreamTrack: raw, stop: vi.fn(), getProcessor: () => undefined });
    const pub = (track: unknown) => ({ source: "screen_share", track, unmute: async () => void calls.unmute++ });
    const room = {
      published: existing ? pub(video()) : undefined,
      localParticipant: {
        getTrackPublication: () => room.published,
        createScreenTracks: async () => {
          calls.create++;
          await new Promise<void>((r) => (pickerOpen = r));
          return [video()];
        },
        publishTrack: async (track: unknown) => {
          calls.publish++;
          return (room.published = pub(track));
        },
        unpublishTrack: async () => void calls.unpublish++,
      },
    };
    return {
      room: room as unknown as ShareRoom,
      calls,
      pick: async () => {
        while (!pickerOpen) await new Promise((r) => setTimeout(r, 1));
        const open = pickerOpen;
        pickerOpen = null;
        open();
      },
      stopFromBrowserBar: () => void (raw = { readyState: "ended" }),
      raw: () => raw,
    };
  }

  it("returns the share that's there, unmuted — never a second", async () => {
    const f = fakeRoom({ existing: true });
    const pub = await shareShieldedScreen(f.room);
    expect(pub?.source).toBe("screen_share");
    expect(f.calls).toMatchObject({ create: 0, publish: 0, unmute: 1 });
  });

  it("makes a second press wait for the first: one picker, one share", async () => {
    const f = fakeRoom();
    const a = shareShieldedScreen(f.room);
    const b = shareShieldedScreen(f.room);
    await f.pick();
    const [pa, pb] = await Promise.all([a, b]);
    expect(pa).toBe(pb);
    expect(f.calls).toMatchObject({ create: 1, publish: 1 });
  });

  it("never publishes a share stopped from the browser's bar while the shield went on", async () => {
    const f = fakeRoom();
    const run = shareShieldedScreen(f.room);
    f.stopFromBrowserBar();
    await f.pick();
    await expect(run).rejects.toThrow(/stopped/);
    expect(f.calls.publish).toBe(0);
    // And a later press starts afresh.
    const again = shareShieldedScreen(f.room);
    await f.pick();
    await expect(again).rejects.toThrow(/stopped/);
    expect(f.calls.create).toBe(2);
  });
});
