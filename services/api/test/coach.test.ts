import { describe, expect, it } from "vitest";
import {
  COACH_AT,
  COACH_GAP_MS,
  COACH_MAX,
  coachHolds,
  coachMoot,
  coachText,
  isStruggle,
  nextCoach,
  type CoachFacts,
  type CoachKind,
} from "../../../lib/coach";

/**
 * The studio's coach (lib/coach.ts): which line comes next, when, and what
 * it says. The web app has no test runner, so its pure rules live here.
 */

const facts = (over: Partial<CoachFacts> = {}): CoachFacts => ({
  elapsedMs: 0,
  practice: false,
  untitled: false,
  viewers: 0,
  guests: 0,
  canInvite: false,
  saveData: false,
  strugglingMs: 0,
  followersTold: undefined,
  ...over,
});

describe("coach rules", () => {
  it("tells the host how many followers heard, right after going live", () => {
    const f = facts({ elapsedMs: 2_000, followersTold: 212 });
    expect(nextCoach(f, [], null, 2_000)).toBe("followers");
    expect(coachText("followers", f)).toBe("We're telling your 212 followers you're live");
    expect(coachText("followers", { followersTold: 1 })).toBe("We're telling your 1 follower you're live");
    expect(coachText("followers", { followersTold: 12_400 })).toBe("We're telling your 12,400 followers you're live");
  });

  it("never invents a number, and says nothing when nobody was told", () => {
    expect(coachText("followers", { followersTold: "unknown" })).toBe("We're telling your followers you're live");
    expect(coachHolds("followers", facts({ followersTold: 0 }))).toBe(false);
    expect(coachHolds("followers", facts({ followersTold: null }))).toBe(false);
    // Before the go-live answer (or on a resume) there's nothing to say.
    expect(coachHolds("followers", facts({ followersTold: undefined }))).toBe(false);
    expect(coachHolds("followers", facts({ practice: true, followersTold: 5 }))).toBe(false);
  });

  it("paces lines at least 20 s apart and stops at six", () => {
    const f = facts({ elapsedMs: 40_000 });
    expect(nextCoach(f, ["followers"], 30_000, 30_000 + COACH_GAP_MS - 1)).toBeNull();
    expect(nextCoach(f, ["followers"], 30_000, 30_000 + COACH_GAP_MS)).toBe("share");
    const six: CoachKind[] = ["followers", "share", "title", "invite", "signal", "practice"];
    expect(nextCoach(facts({ elapsedMs: 600_000, viewers: 3 }), six, 0, 600_000)).toBeNull();
    expect(COACH_MAX).toBe(6);
  });

  it("shows each line once", () => {
    const f = facts({ elapsedMs: 35_000 });
    expect(nextCoach(f, [], null, 0)).toBe("share");
    expect(nextCoach(f, ["share"], null, 0)).toBeNull();
  });

  it("follows the timeline: share at 30 s, title at 50 s, invite at 90 s, keep going at 5 min", () => {
    const base = { untitled: true, canInvite: true, viewers: 2 };
    expect(nextCoach(facts({ ...base, elapsedMs: COACH_AT.share - 1 }), [], null, 0)).toBeNull();
    expect(nextCoach(facts({ ...base, elapsedMs: COACH_AT.share }), [], null, 0)).toBe("share");
    expect(nextCoach(facts({ ...base, elapsedMs: COACH_AT.title }), ["share"], null, 0)).toBe("title");
    expect(nextCoach(facts({ ...base, elapsedMs: COACH_AT.invite }), ["share", "title"], null, 0)).toBe("invite");
    expect(nextCoach(facts({ ...base, elapsedMs: 299_000 }), ["share", "title", "invite"], null, 0)).toBeNull();
    expect(nextCoach(facts({ ...base, elapsedMs: 300_000 }), ["share", "title", "invite"], null, 0)).toBe("keep-going");
  });

  it("only says people are finding the stream when someone is watching", () => {
    expect(coachHolds("keep-going", facts({ elapsedMs: 400_000, viewers: 0 }))).toBe(false);
    expect(coachHolds("keep-going", facts({ elapsedMs: 400_000, viewers: 1 }))).toBe(true);
  });

  it("asks for an invite only with nobody on stage and someone to ask", () => {
    expect(coachHolds("invite", facts({ canInvite: true }))).toBe(true);
    expect(coachHolds("invite", facts({ canInvite: true, guests: 1 }))).toBe(false);
    expect(coachHolds("invite", facts({ canInvite: false }))).toBe(false);
    expect(coachMoot("invite", facts({ guests: 1 }))).toBe(true);
  });

  it("suggests data saver on a sustained struggle, first in line, and drops it once it's on", () => {
    expect(isStruggle({ level: "fair", label: "Low frame rate" })).toBe(true);
    expect(isStruggle({ level: "poor", label: "Upload limited" })).toBe(true);
    expect(isStruggle({ level: "good", label: "Good" })).toBe(false);
    expect(isStruggle({ level: "poor", label: "Not sending" })).toBe(false);
    expect(isStruggle(null)).toBe(false);

    const f = facts({ elapsedMs: 60_000, strugglingMs: 6_000 });
    expect(nextCoach(f, ["followers"], null, 0)).toBe("signal");
    expect(nextCoach({ ...f, strugglingMs: 3_000 }, ["followers"], null, 0)).toBe("share");
    expect(coachHolds("signal", { ...f, saveData: true })).toBe(false);
    expect(coachMoot("signal", facts({ saveData: true }))).toBe(true);
  });

  it("a practice run gets its own line and none of the public ones", () => {
    const f = facts({ practice: true, elapsedMs: 400_000, viewers: 3, canInvite: true, followersTold: 9 });
    expect(nextCoach(f, [], null, 0)).toBe("practice");
    expect(nextCoach(f, ["practice"], null, 0)).toBeNull();
    expect(coachText("practice", f)).toBe("This is a practice run: only people with your link can see it");
  });

  it("retires the title line once there's a title", () => {
    expect(coachMoot("title", facts({ untitled: false }))).toBe(true);
    expect(coachMoot("title", facts({ untitled: true }))).toBe(false);
  });
});
