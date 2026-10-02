import { describe, expect, it } from "vitest";

process.env.R2_PUBLIC_URL = "https://replays.example.com/";

const { isRecorderParticipant, partPatch, replayView } = await import("../src/recording.js");
import type { IStreamRecording, IStreamRecordingPart } from "../src/models.js";

function part(overrides: Partial<IStreamRecordingPart> = {}): IStreamRecordingPart {
  return {
    id: "p1",
    egressId: "EG_one",
    key: "xtream/replays/s1/1-a.mp4",
    status: "complete",
    durationMs: 60_000,
    sizeBytes: 1_000,
    startedAt: new Date(),
    endedAt: new Date(),
    error: "",
    ...overrides,
  };
}

const recording = (parts: IStreamRecordingPart[], extra: Partial<IStreamRecording> = {}): IStreamRecording => ({
  requested: true,
  parts,
  deletedAt: null,
  ...extra,
});

describe("replayView", () => {
  it("is null when the broadcast wasn't recorded or the replay was deleted", () => {
    expect(replayView(null, false)).toBeNull();
    expect(replayView({ requested: false, parts: [], deletedAt: null }, false)).toBeNull();
    expect(replayView(recording([part()], { deletedAt: new Date() }), false)).toBeNull();
  });

  it("is null when the feed never arrived to start a recording", () => {
    expect(replayView(recording([]), false)).toBeNull();
  });

  it("reads as recording while on air, whatever the parts say", () => {
    expect(replayView(recording([]), true)?.status).toBe("recording");
    expect(replayView(recording([part({ status: "active" })]), true)?.status).toBe("recording");
  });

  it("is processing until every part has settled", () => {
    const view = replayView(recording([part(), part({ id: "p2", status: "active" })]), false);
    expect(view?.status).toBe("processing");
  });

  it("plays the written parts in order, from the public URL, never showing the keys", () => {
    const view = replayView(
      recording([
        part(),
        part({ id: "p2", status: "failed", key: "xtream/replays/s1/2-b.mp4" }),
        part({ id: "p3", key: "xtream/replays/s1/3-c.mp4", durationMs: 30_000 }),
      ]),
      false,
    );
    expect(view).toEqual({
      status: "ready",
      durationMs: 90_000,
      parts: [
        { url: "https://replays.example.com/xtream/replays/s1/1-a.mp4", durationMs: 60_000 },
        { url: "https://replays.example.com/xtream/replays/s1/3-c.mp4", durationMs: 30_000 },
      ],
    });
  });

  it("fails when nothing was written", () => {
    expect(replayView(recording([part({ status: "failed" })]), false)).toEqual({ status: "failed", durationMs: 0, parts: [] });
  });
});

describe("partPatch", () => {
  const file = (size: bigint, duration: bigint) => [{ size, duration }] as never;

  it("tracks a running egress as active", () => {
    expect(partPatch({ status: 0, error: "", fileResults: [] })).toEqual({ status: "starting" });
    expect(partPatch({ status: 1, error: "", fileResults: [] })).toEqual({ status: "active" });
    expect(partPatch({ status: 2, error: "", fileResults: [] })).toEqual({ status: "active" });
  });

  it("takes a written file's length (ns → ms) and size", () => {
    const patch = partPatch({ status: 3, error: "", fileResults: file(5_000n, 90_500_000_000n) });
    expect(patch).toMatchObject({ status: "complete", durationMs: 90_500, sizeBytes: 5_000, error: "" });
  });

  it("keeps what a length-capped egress wrote", () => {
    expect(partPatch({ status: 6, error: "", fileResults: file(10n, 1_000_000n) }).status).toBe("complete");
  });

  it("fails a completed egress that wrote nothing, and a failed or aborted one", () => {
    expect(partPatch({ status: 3, error: "", fileResults: [] }).status).toBe("failed");
    expect(partPatch({ status: 4, error: "boom", fileResults: [] })).toMatchObject({ status: "failed", error: "boom" });
    expect(partPatch({ status: 5, error: "", fileResults: [] }).status).toBe("failed");
  });
});

describe("isRecorderParticipant", () => {
  it("knows the egress by its kind or its id-shaped identity", () => {
    expect(isRecorderParticipant({ identity: "anything", kind: 2 })).toBe(true);
    expect(isRecorderParticipant({ identity: "EG_abc123" })).toBe(true);
    expect(isRecorderParticipant({ identity: "64f0c0ffee", kind: 0 })).toBe(false);
    expect(isRecorderParticipant({ identity: "obs-64f0c0ffee" })).toBe(false);
  });
});
