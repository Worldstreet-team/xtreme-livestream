/**
 * How the live stage splits between the host and their guests.
 *
 * The rule is simple and it matters: **split along the container's longer
 * axis.** A phone held upright is tall, so two people stack as rows — each
 * cell stays nearly square. Splitting that same screen into columns would
 * give each person a 187×812 sliver. A desktop player is wide, so the same
 * two people sit side by side instead.
 *
 * Pure and framework-free on purpose — exercised by
 * services/api/test/stage-layout.test.ts, the repo's only test runner.
 */

export interface StageLayout {
  /** Grid classes for the stage container. */
  container: string;
  /** Span classes for the host's cell — the host gets the bigger slot. */
  hostCell: string;
}

/**
 * @param count   People on stage, host included (1–4).
 * @param portrait Is the stage container taller than it is wide?
 */
export function stageLayout(count: number, portrait: boolean): StageLayout {
  // Solo: one cell, no grid needed.
  if (count <= 1) return { container: "", hostCell: "" };

  if (count === 2) {
    return {
      // Two equal halves along the long axis.
      container: portrait ? "grid-rows-2" : "grid-cols-2",
      hostCell: "",
    };
  }

  if (count === 3) {
    // Host takes a full half, the two guests share the other half. Which
    // half is "full" flips with the orientation.
    return {
      container: "grid-cols-2 grid-rows-2",
      hostCell: portrait ? "col-span-2" : "row-span-2",
    };
  }

  // Four: an even 2×2 in either orientation.
  return { container: "grid-cols-2 grid-rows-2", hostCell: "" };
}
