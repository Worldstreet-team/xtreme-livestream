import { describe, expect, it } from "vitest";
import { reactDirector, shotOf, startDirector, stepDirector, type DirectorState, type Shot } from "../../../lib/director";

/**
 * The auto-director's decisions, second by second: it waits for someone to
 * really be talking before it cuts, holds each shot long enough not to
 * flicker, goes to everyone for a conversation or a silence, and cuts to
 * the host for a big gift whatever the hold says.
 */

const HOST = ["host", "obs-host"];
const EVERYONE: Shot = { layout: "auto", spotlight: null };

/** Runs the director at 250 ms steps; `who` says who's talking at each moment. */
function run(start: DirectorState, fromMs: number, toMs: number, who: (t: number) => string[], guests = ["ada", "tolu"]) {
  let state = start;
  const cuts: Array<{ at: number; shot: Shot }> = [];
  for (let t = fromMs; t <= toMs; t += 250) {
    const { state: next, cut } = stepDirector(state, { now: t, speaking: who(t), host: HOST, guests });
    state = next;
    if (cut) cuts.push({ at: t, shot: cut });
  }
  return { state, cuts };
}

describe("the auto-director", () => {
  it("waits for someone to really be talking before it cuts", () => {
    const start = startDirector(0, EVERYONE);
    // A one-second remark from the host: no cut.
    expect(run(start, 0, 4_000, (t) => (t < 1_000 ? ["host"] : [])).cuts).toEqual([]);
    // The host keeps talking: a cut to them alone after 1.8 s.
    const { cuts } = run(start, 0, 4_000, () => ["host"]);
    expect(cuts).toEqual([{ at: 1_750 + 250, shot: { layout: "solo", spotlight: null } }]);
  });

  it("puts the guest who's talking beside the host", () => {
    const start = startDirector(0, EVERYONE);
    const { cuts } = run(start, 0, 5_000, () => ["tolu"]);
    expect(cuts.map((c) => c.shot)).toEqual([{ layout: "split", spotlight: "tolu" }]);
  });

  it("treats short pauses as the same run of speech", () => {
    const start = startDirector(0, EVERYONE);
    // Talking with a 500 ms breath in the middle still reaches 1.8 s.
    const { cuts } = run(start, 0, 3_000, (t) => (t >= 900 && t < 1_400 ? [] : ["ada"]));
    expect(cuts).toEqual([{ at: 2_000, shot: { layout: "split", spotlight: "ada" } }]);
  });

  it("holds a shot for two seconds, and everyone for five", () => {
    // Cut to the host at t=0, with Ada already three seconds into talking:
    // she's earned the shot, but it waits for the host's two seconds.
    const onHost: DirectorState = { ...startDirector(0, { layout: "solo", spotlight: null }), since: 0, runs: { ada: { from: -3_000, last: 0 } } };
    expect(run(onHost, 250, 3_000, () => ["ada"]).cuts[0]).toEqual({ at: 2_000, shot: { layout: "split", spotlight: "ada" } });
    // The same, from everyone: five seconds.
    const onEveryone: DirectorState = { ...startDirector(0, EVERYONE), since: 0, runs: { host: { from: -3_000, last: 0 } } };
    expect(run(onEveryone, 250, 6_000, () => ["host"]).cuts[0]).toEqual({ at: 5_000, shot: { layout: "solo", spotlight: null } });
  });

  it("goes to everyone for a conversation, and after ten seconds of quiet", () => {
    const start = startDirector(0, { layout: "solo", spotlight: null });
    expect(run(start, 0, 3_000, () => ["host", "ada"]).cuts.map((c) => c.shot)).toEqual([EVERYONE]);
    const quiet = run(start, 0, 12_000, () => []);
    expect(quiet.cuts).toEqual([{ at: 10_000, shot: EVERYONE }]);
  });

  it("with one guest, the host and that guest is simply everyone", () => {
    const start = startDirector(0, { layout: "solo", spotlight: null });
    const { cuts } = run(start, 0, 4_000, () => ["ada"], ["ada"]);
    expect(cuts.map((c) => c.shot)).toEqual([EVERYONE]);
  });

  it("doesn't keep a guest in the spotlight once they've left the stage", () => {
    const start = startDirector(0, { layout: "split", spotlight: "tolu" });
    const { cuts } = run(start, 0, 1_000, () => [], ["ada", "sam"]);
    expect(cuts.map((c) => c.shot)).toEqual([EVERYONE]);
  });

  it("cuts to the host for a big gift, then gets back to the room", () => {
    // Ada talking, on screen with the host since t=0 (the hold isn't over).
    const talking = run(startDirector(0, EVERYONE), 0, 2_500, () => ["ada"]);
    expect(talking.state.shot).toEqual({ layout: "split", spotlight: "ada" });
    const gift = reactDirector(talking.state, 2_500);
    const after = run(gift, 2_750, 12_000, () => ["ada"]);
    expect(after.cuts[0]).toEqual({ at: 2_750, shot: { layout: "solo", spotlight: null } });
    // Six seconds on, and Ada still talking: back beside her.
    expect(after.cuts[1]).toEqual({ at: 8_500, shot: { layout: "split", spotlight: "ada" } });
  });

  it("reads the shot a scene is in", () => {
    expect(shotOf({ layout: "split", spotlight: "ada" })).toEqual({ layout: "split", spotlight: "ada" });
    expect(shotOf({ layout: "grid" })).toEqual(EVERYONE);
    expect(shotOf({ layout: "solo", spotlight: "ada" })).toEqual({ layout: "solo", spotlight: null });
  });
});
