/**
 * The chat's data model: what arrives on the wire, and how it's folded into
 * lines to draw. Kept apart from the component so the rules are plain
 * functions — the room's noise (drops, gift combos) is decided here, not in
 * JSX.
 */

export type ChatPlatform = "xstream" | "socials" | "worldspace";

/** A message as it arrives — from history, the room, or our own send. */
export interface ChatMsg {
  id: string;
  /** Sender's user id — what the host's ban/timeout buttons act on. */
  userId?: string;
  username: string;
  avatar: string;
  isMod?: boolean;
  /** Surface the sender was on; WorldSpace gets a badge. */
  platform?: ChatPlatform;
  /** For "stage" rows, the verb ("joined the stage"). */
  content: string;
  type: "text" | "tip" | "reaction" | "stage";
  tipAmount?: string;
  tipCurrency?: string;
  emoji?: string;
  /** Epoch ms, for the hover time. */
  at: number;
  /** My own line, held by the filter: only I see it, waiting on a moderator. */
  pending?: boolean;
}

/** One thing in the chat, ready to draw. */
export type ChatLine =
  | { kind: "chat"; id: string; msg: ChatMsg }
  | { kind: "gift"; id: string; msg: ChatMsg; count: number; total: number; ids: string[] }
  | { kind: "drops"; id: string; catches: ChatMsg[] }
  | { kind: "stage"; id: string; msg: ChatMsg };

/** A drop: the room sweep paying one viewer points, written into chat. */
export function isDrop(msg: ChatMsg) {
  return msg.type === "tip" && msg.tipCurrency === "PTS" && msg.content === "caught a drop";
}

/** Dollars (USD tips) or points (PTS) — the two amounts a gift line can carry. */
export function giftUnit(msg: ChatMsg): "usd" | "pts" | "other" {
  if (msg.tipCurrency === "PTS") return "pts";
  if (!msg.tipCurrency || msg.tipCurrency === "USD") return "usd";
  return "other";
}

/** A gift's amount in the unit it folds in: cents for dollars, whole points for points. */
export function giftAmount(msg: ChatMsg) {
  const n = parseFloat(msg.tipAmount ?? "0") || 0;
  return giftUnit(msg) === "usd" ? Math.round(n * 100) : Math.round(n);
}

/**
 * Raw messages → lines.
 *
 * Back-to-back drops fold into one line: a quiet room only hears the sweep,
 * and its history used to be a wall of "+50 pts". A gift sent again and
 * again — same sender, same gift, same amount, nothing in between — folds
 * into a combo (×N), the way a tap-happy gifter reads in a real room. Each
 * run keeps its first message's id as its key, so it grows in place.
 */
export function foldLines(list: ChatMsg[]): ChatLine[] {
  const lines: ChatLine[] = [];
  for (const msg of list) {
    const last = lines[lines.length - 1];
    if (isDrop(msg)) {
      if (last?.kind === "drops") {
        last.catches.push(msg);
      } else {
        lines.push({ kind: "drops", id: msg.id, catches: [msg] });
      }
      continue;
    }
    if (msg.type === "tip") {
      const combo =
        last?.kind === "gift" &&
        giftUnit(msg) !== "other" &&
        last.msg.username === msg.username &&
        last.msg.emoji === msg.emoji &&
        last.msg.tipAmount === msg.tipAmount &&
        last.msg.tipCurrency === msg.tipCurrency;
      if (combo) {
        last.count += 1;
        last.total += giftAmount(msg);
        // Any gift in the run can be the one on screen (the tier puts up the newest).
        last.ids.push(msg.id);
      } else {
        lines.push({ kind: "gift", id: msg.id, msg, count: 1, total: giftAmount(msg), ids: [msg.id] });
      }
      continue;
    }
    if (msg.type === "stage") {
      lines.push({ kind: "stage", id: msg.id, msg });
      continue;
    }
    lines.push({ kind: "chat", id: msg.id, msg });
  }
  return lines;
}

/**
 * A stable colour per name — Twitch's oldest trick for telling people apart
 * in a fast chat. Light enough for the dark panel; Chili, Ember and gold
 * are kept out, since they mean live, energy and money here.
 */
const NAME_COLORS = [
  "#7DD3FC", // sky
  "#86EFAC", // mint
  "#C4B5FD", // lilac
  "#F9A8D4", // pink
  "#5EEAD4", // teal
  "#A5B4FC", // periwinkle
  "#BEF264", // lime
  "#93C5FD", // blue
] as const;

export function nameColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

/** Whether a message calls this user out by @name. */
export function mentions(text: string, username: string | undefined) {
  if (!username) return false;
  return text.toLowerCase().includes(`@${username.toLowerCase()}`);
}
