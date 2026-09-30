import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; its messaging wording is pure
// and exercised from here (the repo's only vitest) via a relative import.
import {
  callOutcome,
  contextHref,
  describeMessage,
  durationLabel,
  needsStamp,
  stampLabel,
  waveformBars,
  lastSeenLabel,
  personName,
  platformName,
  pollFootnote,
  shortTime,
  streamContext,
  systemEventCopy,
  viaPlatform,
} from "../../lib/messaging-copy";

const ADA = "a".repeat(24);
const TUNDE = "b".repeat(24);
const ME = "c".repeat(24);

const event = (kind: string, params: Record<string, unknown> = {}) => ({
  kind,
  params: { actor: ADA, actorName: "Ada", subject: TUNDE, subjectName: "Tunde", ...params },
});

describe("systemEventCopy", () => {
  it("names both people from the row, the way WorldSpace words it", () => {
    expect(systemEventCopy(event("group.joined"), undefined, ME)).toBe("Ada added Tunde");
    expect(systemEventCopy(event("group.removed", { banned: true }), undefined, ME)).toBe("Ada removed and banned Tunde");
    expect(systemEventCopy(event("group.renamed", { from: "Owls", name: "Night Owls" }))).toBe(
      'Ada renamed the group from "Owls" to "Night Owls"',
    );
  });

  it("says You when the viewer did it, and you when it happened to them", () => {
    expect(systemEventCopy(event("group.joined", { actor: ME }), undefined, ME)).toBe("You added Tunde");
    expect(systemEventCopy(event("group.joined", { subject: ME }), undefined, ME)).toBe("Ada added you");
    expect(systemEventCopy(event("group.removed", { subject: ME }), undefined, ME)).toBe("Ada removed you");
    expect(systemEventCopy(event("group.left", { subject: ME }), undefined, ME)).toBe("You left the group");
    expect(systemEventCopy(event("group.promoted", { subject: ME }), undefined, ME)).toBe("You're an admin now");
  });

  it("capitalises a sentence that opens on the subject", () => {
    expect(systemEventCopy(event("group.joined", { subject: ME, viaLink: true }), undefined, ME)).toBe(
      "You joined by invite link",
    );
    expect(systemEventCopy(event("group.joined", { subject: ME, viaInvite: true }), undefined, ME)).toBe("You joined");
    expect(systemEventCopy(event("group.left"), undefined, ME)).toBe("Tunde left");
  });

  it("agrees the verb with you", () => {
    expect(systemEventCopy(event("group.demoted", { subject: ME }), undefined, ME)).toBe("You are no longer an admin");
    expect(systemEventCopy(event("group.demoted"), undefined, ME)).toBe("Tunde is no longer an admin");
  });

  it("spells out settings, slow mode and disappearing spans", () => {
    expect(systemEventCopy(event("group.settings", { changed: ["send", "media", "pin"] }))).toBe(
      "Ada changed who can send messages, send media and pin messages",
    );
    expect(systemEventCopy(event("group.slowmode", { seconds: 300 }))).toBe(
      "Ada turned on slow mode: one message every 5 minutes",
    );
    expect(systemEventCopy(event("group.slowmode", { seconds: 0 }))).toBe("Ada turned off slow mode");
    expect(systemEventCopy(event("group.disappearing", { seconds: 604800 }))).toBe(
      "Ada set messages to disappear after 7 days",
    );
  });

  it("falls back to the sender's name, then to Someone", () => {
    expect(systemEventCopy({ kind: "group.pinned", params: { actor: ADA } }, "Ada O.")).toBe("Ada O. pinned a message");
    expect(systemEventCopy({ kind: "message.pinned" })).toBe("Someone pinned a message");
  });

  it("returns nothing for a kind it doesn't know, so the thread can leave it out", () => {
    expect(systemEventCopy(event("group.teleported"))).toBe("");
  });
});

describe("describeMessage", () => {
  it("says what a message is when it has no words of its own", () => {
    expect(describeMessage({ type: "image", content: "" })).toBe("Photo");
    expect(describeMessage({ type: "image", content: "sunset" })).toBe("sunset");
    expect(describeMessage({ type: "audio", content: "" })).toBe("Voice note");
    expect(describeMessage({ type: "group_invite", content: "" })).toBe("Group invite");
  });

  it("uses the gateway's own call summary", () => {
    expect(describeMessage({ type: "call", content: "Missed video call" })).toBe("Missed video call");
    expect(describeMessage({ type: "call", content: "" })).toBe("Call");
  });

  it("previews a poll by its question", () => {
    expect(describeMessage({ type: "poll", content: "", poll: { question: "Best set?" } })).toBe("Poll: Best set?");
  });

  it("previews a group's system row as a sentence", () => {
    expect(describeMessage({ type: "system", content: "", systemEvent: event("group.locked") })).toBe(
      "Ada locked the group, only admins can send",
    );
    expect(describeMessage({ type: "system", content: "", systemEvent: { kind: "nope" } })).toBe("Update");
    // The inbox passes the viewer, so its preview agrees with the thread.
    expect(
      describeMessage({ type: "system", content: "", systemEvent: event("group.joined", { subject: ME, viaInvite: true }) }, ME),
    ).toBe("You joined");
  });

  it("never leaks the words of a message an admin removed", () => {
    expect(describeMessage({ type: "text", content: "secret", removedBy: ADA })).toBe("Message removed");
  });
});

describe("personName", () => {
  it("prefers a full name and falls back to the handle", () => {
    expect(personName({ username: "ada", firstName: "Ada", lastName: "Okafor" })).toBe("Ada Okafor");
    expect(personName({ username: "ada", firstName: " ", lastName: "" })).toBe("ada");
    expect(personName(null)).toBe("");
  });
});

describe("pollFootnote", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

  it("counts votes and names the poll's rules", () => {
    expect(pollFootnote({ total: 1 }, now)).toBe("1 vote");
    expect(pollFootnote({ total: 3, anonymous: true, multi: true }, now)).toBe("3 votes · Anonymous · Pick any");
  });

  it("says when it ends, and when it has", () => {
    expect(pollFootnote({ total: 0, endsAt: inMinutes(30) }, now)).toBe("0 votes · Ends in 30m");
    expect(pollFootnote({ total: 2, endsAt: inMinutes(3 * 1440) }, now)).toBe("2 votes · Ends in 3d");
    expect(pollFootnote({ total: 9, endsAt: inMinutes(-1) }, now)).toBe("9 votes · Final results");
  });
});

describe("times", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it("shortTime reads like an inbox", () => {
    expect(shortTime(ago(0.5), now)).toBe("now");
    expect(shortTime(ago(5), now)).toBe("5m");
    expect(shortTime(ago(180), now)).toBe("3h");
    expect(shortTime(undefined, now)).toBe("");
  });

  it("lastSeenLabel stops talking after a day", () => {
    expect(lastSeenLabel(ago(1), now)).toBe("Active now");
    expect(lastSeenLabel(ago(12), now)).toBe("Active 12m ago");
    expect(lastSeenLabel(ago(300), now)).toBe("Active 5h ago");
    expect(lastSeenLabel(ago(2 * 1440), now)).toBeNull();
    expect(lastSeenLabel(undefined, now)).toBeNull();
  });
});

describe("thread context links", () => {
  it("points a stream's chip at the public site, never localhost", () => {
    const ctx = streamContext({ _id: "65f0c0ffee", title: "Late set" });
    expect(ctx).toEqual({
      kind: "stream",
      id: "65f0c0ffee",
      title: "Late set",
      url: "https://xtream.worldstreetgold.com/stream/65f0c0ffee",
    });
  });

  it("keeps a title inside the gateway's 120-character cap", () => {
    expect(streamContext({ _id: "x", title: "t".repeat(300) }).title).toHaveLength(120);
    expect(streamContext({ _id: "x" })).not.toHaveProperty("title");
  });

  it("follows our own links in the app and sends others out", () => {
    expect(contextHref("https://xtream.worldstreetgold.com/stream/abc")).toEqual({ href: "/stream/abc", internal: true });
    // A thread opened while the site lived on its previous host still carries that link.
    expect(contextHref("https://xtreme.worldstreetgold.com/stream/abc")).toEqual({ href: "/stream/abc", internal: true });
    expect(contextHref("https://shop.worldstreetgold.com/orders/9")).toEqual({
      href: "https://shop.worldstreetgold.com/orders/9",
      internal: false,
    });
    // A lookalike host is not ours.
    expect(contextHref("https://xtream.worldstreetgold.com.evil.example/x").internal).toBe(false);
  });
});

describe("the thread's rhythm", () => {
  const at = (iso: string) => new Date(iso).toISOString();

  it("stamps the first message, a new day, and an hour of quiet — nothing else", () => {
    expect(needsStamp(undefined, at("2026-09-25T10:00:00"))).toBe(true);
    expect(needsStamp(at("2026-09-25T10:00:00"), at("2026-09-25T10:40:00"))).toBe(false);
    expect(needsStamp(at("2026-09-25T10:00:00"), at("2026-09-25T11:00:00"))).toBe(true);
    expect(needsStamp(at("2026-09-24T23:50:00"), at("2026-09-25T00:05:00"))).toBe(true);
  });

  it("labels a stamp by how long ago it was", () => {
    const now = new Date("2026-09-25T18:00:00");
    expect(stampLabel(at("2026-09-25T09:41:00"), now)).toMatch(/^Today · 9:41/);
    expect(stampLabel(at("2026-09-24T21:05:00"), now)).toMatch(/^Yesterday · 9:05/);
    expect(stampLabel(at("2025-03-02T08:00:00"), now)).toMatch(/2025 · 8:00/);
  });

  it("reads a call row's outcome from the gateway's wording", () => {
    expect(callOutcome("Missed video call")).toEqual({ missed: true, video: true });
    expect(callOutcome("Voice call · 4 min")).toEqual({ missed: false, video: false });
    expect(callOutcome("Call declined")).toEqual({ missed: true, video: false });
  });

  it("formats a voice note's length", () => {
    expect(durationLabel(7.4)).toBe("0:07");
    expect(durationLabel(92)).toBe("1:32");
    expect(durationLabel(undefined)).toBe("0:00");
  });

  it("resamples real peaks, and gives a note without them a stable shape", () => {
    const bars = waveformBars([0, 0.5, 1, 0.25], 2);
    expect(bars).toEqual([0.5, 1]);
    const a = waveformBars(undefined, 24, "msg-1");
    expect(a).toHaveLength(24);
    expect(a).toEqual(waveformBars(undefined, 24, "msg-1"));
    expect(a).not.toEqual(waveformBars(undefined, 24, "msg-2"));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0.12);
  });
});

describe("where it came from", () => {
  it("names WorldSpace — web and phone app alike — and never home", () => {
    expect(viaPlatform("worldspace")).toBe("via WorldSpace");
    expect(viaPlatform("app")).toBe("via WorldSpace");
    expect(viaPlatform("xstream")).toBeNull();
    expect(viaPlatform(undefined)).toBeNull();
  });

  it("names the other WorldStreet apps, and one it doesn't know yet", () => {
    expect(viaPlatform("dashboard")).toBe("via Dashboard");
    expect(platformName("academy")).toBe("Academy");
    expect(platformName("arcade")).toBe("Arcade");
  });
});
