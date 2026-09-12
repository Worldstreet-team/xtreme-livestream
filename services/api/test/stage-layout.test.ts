import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; this pure helper is exercised
// from here (the repo's only vitest) via a relative import. No API code
// involved — it's the geometry the live stage splits along.
import { stageLayout } from "../../lib/stage-layout";

describe("stageLayout", () => {
  it("gives a solo host the whole frame", () => {
    expect(stageLayout(1, true)).toEqual({ container: "", hostCell: "" });
    expect(stageLayout(1, false)).toEqual({ container: "", hostCell: "" });
  });

  it("splits two people along the container's LONG axis", () => {
    // A phone is tall: stacking keeps each cell nearly square. Columns
    // here would hand each person a vertical sliver.
    expect(stageLayout(2, true).container).toBe("grid-rows-2");
    // A desktop player is wide: side by side is the natural split.
    expect(stageLayout(2, false).container).toBe("grid-cols-2");
  });

  it("gives the host the full half when three are on stage", () => {
    const portrait = stageLayout(3, true);
    expect(portrait.container).toBe("grid-cols-2 grid-rows-2");
    // Host spans the top row; the two guests share the bottom.
    expect(portrait.hostCell).toBe("col-span-2");

    const landscape = stageLayout(3, false);
    expect(landscape.container).toBe("grid-cols-2 grid-rows-2");
    // Host spans the left column; the two guests stack on the right.
    expect(landscape.hostCell).toBe("row-span-2");
  });

  it("uses an even 2x2 for four, in either orientation", () => {
    for (const portrait of [true, false]) {
      expect(stageLayout(4, portrait)).toEqual({
        container: "grid-cols-2 grid-rows-2",
        hostCell: "",
      });
    }
  });

  it("treats a stage bigger than the cap as a 2x2", () => {
    // MAX_STAGE_GUESTS bounds this server-side, but the layout must not
    // fall apart if a stale roster briefly reports more.
    expect(stageLayout(6, true).container).toBe("grid-cols-2 grid-rows-2");
  });

  it("never returns spans without a grid to span", () => {
    for (const count of [0, 1, 2]) {
      for (const portrait of [true, false]) {
        const { container, hostCell } = stageLayout(count, portrait);
        if (hostCell) expect(container).toContain("grid-");
      }
    }
  });
});
