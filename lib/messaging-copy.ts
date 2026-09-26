/**
 * How messaging reads in Xtream: names, one-line previews, times, and the
 * sentences a group's system rows turn into. Pure and dependency-free, so
 * the inbox, the thread and the tests all share one copy of the wording.
 */

type Person = { username: string; firstName?: string; lastName?: string };

/** "Ada Okafor", falling back to the handle. */
export function personName(p: Person | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.username;
}

export interface SystemEvent {
  kind: string;
  params?: Record<string, unknown>;
}

/** Anything with enough of a message to describe it in one line: a thread
 *  row, an inbox row's last message, or a reply's quote. */
interface Describable {
  type: string;
  content: string;
  poll?: { question: string };
  removedBy?: string;
  systemEvent?: SystemEvent;
}

/** What a message says in one line: its words, or what kind of thing it is.
 *  Pass the viewer so a group's system row can say "You". */
export function describeMessage(m: Describable, viewerId?: string | null): string {
  if (m.removedBy) return "Message removed";
  switch (m.type) {
    case "image":
      return m.content || "Photo";
    case "video":
      return m.content || "Video";
    case "audio":
      return "Voice note";
    case "call":
      // The gateway words it already: "Missed video call", "Voice call · 4 min".
      return m.content || "Call";
    case "payment":
      return "Payment";
    case "contact":
      return "Contact";
    case "poll": {
      const question = m.poll?.question || m.content;
      return question ? `Poll: ${question}` : "Poll";
    }
    case "group_invite":
      return "Group invite";
    case "system":
      return (m.systemEvent && systemEventCopy(m.systemEvent, undefined, viewerId)) || "Update";
    default:
      return m.content;
  }
}

/**
 * One line for a group's system row, in WorldSpace's own words — ported
 * from its groupSystem.ts so a thread reads the same in both apps. The
 * gateway stores the event and both names; the client owns the wording.
 * Viewer-relative: "You" when you did it or it happened to you. "" for a
 * kind this copy doesn't know, which the thread leaves out.
 *
 * Two slips fixed on the way over, on purpose: a sentence that opens on
 * the subject is capitalised ("You joined", not "you joined"), and "you
 * are no longer an admin" rather than "you is".
 */
export function systemEventCopy(event: SystemEvent, senderName?: string, viewerId?: string | null): string {
  const p = event.params ?? {};
  const viewerIsActor = Boolean(viewerId) && String(p.actor ?? "") === String(viewerId);
  const viewerIsSubject = Boolean(viewerId) && String(p.subject ?? "") === String(viewerId);
  const actor = viewerIsActor ? "You" : (p.actorName as string) || senderName || "Someone";
  const subject = viewerIsSubject ? "you" : (p.subjectName as string) || "someone";
  // A sentence can open on the subject ("you joined"): capitalise that.
  const lead = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  switch (event.kind) {
    case "group.created":
      return `${actor} created "${(p.name as string) ?? "the group"}"`;
    case "group.renamed":
      return p.from
        ? `${actor} renamed the group from "${p.from as string}" to "${(p.name as string) ?? ""}"`
        : `${actor} renamed the group to "${(p.name as string) ?? ""}"`;
    case "group.avatar":
      return p.removed ? `${actor} removed the group photo` : `${actor} changed the group photo`;
    case "group.joined":
      if (p.viaLink) return `${lead(subject)} joined by invite link`;
      if (p.approved) return `${actor} let ${subject} in`;
      return p.viaInvite ? `${lead(subject)} joined` : `${actor} added ${subject}`;
    case "group.description":
      return p.removed ? `${actor} removed the description` : `${actor} changed the description`;
    case "group.history":
      if (typeof p.share === "number")
        return p.share > 0
          ? `${actor} set new members to see the last ${p.share} messages`
          : `${actor} hid past messages from new members`;
      return p.visible ? `${actor} let new members see past messages` : `${actor} hid past messages from new members`;
    case "group.slowmode":
      return Number(p.seconds) > 0
        ? `${actor} turned on slow mode: one message every ${slowWords(p.seconds)}`
        : `${actor} turned off slow mode`;
    case "group.disappearing":
      return Number(p.seconds) > 0
        ? `${actor} set messages to disappear after ${spanWords(p.seconds)}`
        : `${actor} turned off disappearing messages`;
    case "group.pinned":
    case "message.pinned":
      return `${actor} pinned a message`;
    case "group.unpinned":
      return `${actor} unpinned a message`;
    case "group.restricted":
      return viewerIsSubject
        ? `${actor} paused your messages for a while`
        : `${actor} paused ${subject}'s messages for a while`;
    case "group.unrestricted":
      return viewerIsSubject ? `${actor} let you send messages again` : `${actor} let ${subject} send messages again`;
    case "group.restored":
      return `${actor} restored the group`;
    case "group.settings":
      return `${actor} changed who can ${settingWords(p.changed)}`;
    case "group.left":
      if (p.accountDeleted) return `${lead(subject)}'s account was deleted`;
      return viewerIsSubject ? "You left the group" : `${lead(subject)} left`;
    case "group.removed":
      if (p.banned) return viewerIsSubject ? `${actor} removed and banned you` : `${actor} removed and banned ${subject}`;
      return viewerIsSubject ? `${actor} removed you` : `${actor} removed ${subject}`;
    case "group.approval":
      return p.on ? `${actor} turned on approval for new members` : `${actor} turned off approval for new members`;
    case "group.promoted":
      return viewerIsSubject ? "You're an admin now" : `${lead(subject)} is now an admin`;
    case "group.demoted":
      return `${lead(subject)} ${viewerIsSubject ? "are" : "is"} no longer an admin`;
    case "group.owner":
      return viewerIsSubject ? "You own the group now" : `${lead(subject)} owns the group now`;
    case "group.locked":
      return `${actor} locked the group, only admins can send`;
    case "group.unlocked":
      return `${actor} unlocked the group`;
    default:
      return "";
  }
}

function slowWords(seconds: unknown): string {
  const s = Number(seconds) || 0;
  if (s >= 3600) return `${Math.round(s / 3600)} hour${s >= 7200 ? "s" : ""}`;
  if (s >= 60) return `${Math.round(s / 60)} minute${s >= 120 ? "s" : ""}`;
  return `${s} seconds`;
}

function spanWords(seconds: unknown): string {
  const s = Number(seconds) || 0;
  if (s >= 7776000) return "90 days";
  if (s >= 604800) return "7 days";
  if (s >= 86400) return "24 hours";
  return `${s} seconds`;
}

const SETTING_WORDS: Record<string, string> = {
  send: "send messages",
  media: "send media",
  addMembers: "add people",
  editInfo: "edit the group",
  pin: "pin messages",
  calls: "start calls",
  mentionAll: "mention everyone",
  money: "send money",
};

function settingWords(changed: unknown): string {
  const words = (Array.isArray(changed) ? changed.map(String) : []).map((k) => SETTING_WORDS[k] ?? k);
  if (words.length === 0) return "do what";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/* ---------------- Context links ---------------- */

/**
 * Xtream's public origin. A thread's context link is written once, by
 * whoever opens the thread first, and WorldSpace shows it forever — so it
 * always names the real site, never the localhost a thread was opened from.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://xtreme.worldstreetgold.com").replace(/\/+$/, "");

/** What a thread is about, as the gateway stores it (its ThreadContext). */
interface Context {
  kind: string;
  id: string;
  title?: string;
  url?: string;
}

/** "About this stream": the chip both sides see on a thread opened from one. */
export function streamContext(stream: { _id: string; title?: string }): Context {
  return {
    kind: "stream",
    id: String(stream._id),
    // The gateway caps a context title at 120 characters.
    ...(stream.title ? { title: stream.title.slice(0, 120) } : {}),
    url: `${SITE_URL}/stream/${stream._id}`,
  };
}

/** A context link, as this app should follow it: our own pages stay in the
 *  app (so localhost stays on localhost); anything else goes out as is. */
export function contextHref(url: string): { href: string; internal: boolean } {
  return url.startsWith(`${SITE_URL}/`)
    ? { href: url.slice(SITE_URL.length), internal: true }
    : { href: url, internal: false };
}

/* ---------------- Time ---------------- */

/** "now", "3m", "2h", "Tue", "Sep 12": the inbox's timestamp. */
export function shortTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  if (hours < 24 * 7) return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Today", "Yesterday", "Tuesday", "Sep 12": a thread's day separator. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "9:41 PM": a message's own time. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Active now", "Active 12m ago": a person's last-seen line, or null
 *  after a day (an old last-seen says nothing useful). */
export function lastSeenLabel(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return "Active now";
  if (mins < 60) return `Active ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  return null;
}

/** Your own text can be changed for fifteen minutes (the gateway's rule). */
export const EDIT_WINDOW_MS = 15 * 60_000;

/** Unsend reaches everyone for two days; after that it's "delete for me". */
export const UNSEND_WINDOW_MS = 48 * 3600 * 1000;

/** Under a poll: "12 votes · Anonymous · Ends in 3h" / "Final results". */
export function pollFootnote(
  poll: { total?: number; anonymous?: boolean; multi?: boolean; endsAt?: string },
  now = Date.now(),
): string {
  const total = poll.total ?? 0;
  const parts = [total === 1 ? "1 vote" : `${total} votes`];
  if (poll.anonymous) parts.push("Anonymous");
  if (poll.multi) parts.push("Pick any");
  if (poll.endsAt) {
    const left = new Date(poll.endsAt).getTime() - now;
    if (left <= 0) return [...parts, "Final results"].join(" · ");
    const mins = Math.ceil(left / 60_000);
    parts.push(
      mins < 60 ? `Ends in ${mins}m` : mins < 60 * 24 ? `Ends in ${Math.round(mins / 60)}h` : `Ends in ${Math.round(mins / 1440)}d`,
    );
  }
  return parts.join(" · ");
}

/* ---------------- The thread's rhythm ---------------- */

/** Messages closer than this share a stamp; a longer silence earns a new one. */
export const STAMP_GAP_MS = 60 * 60_000;

/** Whether a centred stamp belongs above a message: the first one, a new
 *  day, or an hour of quiet (Instagram's grammar, which WorldSpace follows). */
export function needsStamp(prevIso: string | undefined, iso: string): boolean {
  if (!prevIso) return true;
  const a = new Date(prevIso);
  const b = new Date(iso);
  return a.toDateString() !== b.toDateString() || b.getTime() - a.getTime() >= STAMP_GAP_MS;
}

/** "Today · 9:41 PM", "Yesterday · 9:41 PM", "Tuesday · 9:41 PM",
 *  "Sep 12 · 9:41 PM", "Sep 12, 2025 · 9:41 PM". */
export function stampLabel(iso: string, now = new Date()): string {
  // dayLabel already says Today / Yesterday / a weekday / a date (with the
  // year when it isn't this one).
  return `${dayLabel(iso, now)} · ${clockTime(iso)}`;
}

/** What a call row says about itself: missed or answered, voice or video. */
export function callOutcome(content: string): { missed: boolean; video: boolean } {
  return { missed: /missed|declined|cancel|no answer/i.test(content), video: /video/i.test(content) };
}

/** "0:07", "1:32", "12:05": a voice note or a clip's length. */
export function durationLabel(sec: number | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A waveform of exactly `bars` values in 0.12..1. Real peaks are resampled;
 *  a note without them gets a stable shape from its id, so it never jumps. */
export function waveformBars(peaks: number[] | undefined, bars: number, seed = ""): number[] {
  if (peaks && peaks.length) {
    return Array.from({ length: bars }, (_, i) => {
      const from = Math.floor((i * peaks.length) / bars);
      const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / bars));
      const slice = peaks.slice(from, to);
      const v = slice.reduce((a, b) => Math.max(a, b), 0);
      return Math.min(1, Math.max(0.12, v));
    });
  }
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 16777619);
    const r = ((h >>> 0) % 1000) / 1000;
    // A voice has a shape: louder in the middle, quieter at the edges.
    const envelope = 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / bars);
    return Math.min(1, Math.max(0.12, r * envelope));
  });
}

/* ---------------- Where it came from ---------------- */

/**
 * The platform a message or a call came from, named from Xtream's side
 * (owner: "know if a message is from WorldSpace or from Xstream", "if a
 * missed call is from WorldSpace or from Xstream"). The gateway stamps
 * `source` on every message and `platform` on every ring. WorldSpace and
 * its phone app are one place; Xtream is home and is never named — the
 * mirror of WorldSpace, which names Xtream and never itself. A platform
 * this list doesn't know yet is still named, not hidden.
 */
const PLATFORM_NAMES: Record<string, string> = {
  worldspace: "WorldSpace",
  app: "WorldSpace",
  dashboard: "Dashboard",
  academy: "Academy",
  shop: "Shop",
};

export function platformName(source: string | null | undefined): string | null {
  if (!source || source === "xstream") return null;
  return PLATFORM_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/** "via WorldSpace" for anything sent or rung from elsewhere, else null. */
export function viaPlatform(source: string | null | undefined): string | null {
  const name = platformName(source);
  return name ? `via ${name}` : null;
}
