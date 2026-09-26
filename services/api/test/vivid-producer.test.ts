import { beforeEach, describe, expect, it } from "vitest";

/**
 * Vivid as producer: each voice tool turns into exactly the studio request
 * it names, in order, through the production bridge — and a ban never goes
 * through without a spoken yes.
 */

// The tools only run in a browser.
(globalThis as { window?: unknown }).window ??= globalThis;

const tools = await import("../../../lib/vivid-functions");
const { registerProductionBridge } = await import("../../../lib/vivid/page-context");
type Request = import("../../../lib/vivid/page-context").ProductionRequest;

let seen: Request[] = [];
let unregister = () => {};
beforeEach(() => {
  seen = [];
  unregister();
  unregister = registerProductionBridge(async (req) => {
    seen.push(req);
    return { success: true };
  });
});

const call = (tool: { handler: (args: never) => unknown }, args: Record<string, unknown>) => Promise.resolve(tool.handler(args as never)) as Promise<Record<string, unknown>>;

describe("Vivid's producer tools", () => {
  it("frames a shot: the layout, then who's beside the host, then the card", async () => {
    await call(tools.sceneControl, { layout: "split", guest: "Ada", card: "none" });
    expect(seen).toEqual([
      { do: "layout", layout: "split" },
      { do: "spotlight", guest: "Ada" },
      { do: "card", card: null },
    ]);
  });

  it("reads a market as a chart, whatever layout was asked", async () => {
    await call(tools.sceneControl, { market: "SOL", layout: "solo" });
    expect(seen).toEqual([{ do: "chart", market: "SOL" }]);
  });

  it("shows and hides graphics, and asks for what it needs", async () => {
    await call(tools.graphicsControl, { action: "show", graphic: "lower_third", title: "Ada K", subtitle: "Guest" });
    await call(tools.graphicsControl, { action: "show", graphic: "countdown", minutes: 3 });
    await call(tools.graphicsControl, { action: "hide", graphic: "sponsor" });
    expect(seen).toEqual([
      { do: "lower_third", title: "Ada K", subtitle: "Guest" },
      { do: "countdown", minutes: 3, label: undefined },
      { do: "hide", graphic: "sponsor" },
    ]);
    expect(await call(tools.graphicsControl, { action: "show", graphic: "banner" })).toEqual({ error: "What should the banner say?" });
  });

  it("runs the show: start, next, prompter, director", async () => {
    for (const action of ["start_show", "next_segment", "prompter_on", "director_off"]) await call(tools.showControl, { action });
    expect(seen).toEqual([
      { do: "show", step: "start" },
      { do: "show", step: "next" },
      { do: "prompter", on: true },
      { do: "director", on: false },
    ]);
  });

  it("won't ban anyone without a spoken yes", async () => {
    const asked = await call(tools.roomControl, { action: "ban", username: "@spammer" });
    expect(asked).toMatchObject({ needsConfirmation: true, username: "@spammer" });
    expect(seen).toEqual([]);
    await call(tools.roomControl, { action: "ban", username: "@spammer", minutes: 10, confirmed: true });
    await call(tools.roomControl, { action: "shield_on" });
    expect(seen).toEqual([
      { do: "ban", username: "spammer", minutes: 10 },
      { do: "shield", on: true },
    ]);
  });

  it("opens a prediction with at most four outcomes", async () => {
    await call(tools.startPrediction, { question: "BTC above 90k at the close?", outcomes: ["Yes", "No", "Flat", "Maybe", "Extra"], seconds: 90 });
    expect(seen).toEqual([{ do: "prediction", question: "BTC above 90k at the close?", outcomes: ["Yes", "No", "Flat", "Maybe"], seconds: 90 }]);
    expect(await call(tools.startPrediction, { question: "Up?", outcomes: ["Yes"] })).toHaveProperty("error");
  });

  it("says the user isn't in the studio when nothing answers", async () => {
    unregister();
    expect(await call(tools.showControl, { action: "next_segment" })).toEqual({ error: "The user isn't in the studio. Use navigateToPage(studio) first." });
  });

  it("is in the list Vivid is given", () => {
    const names = tools.xtremeFunctions.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["sceneControl", "graphicsControl", "showControl", "startPrediction", "roomControl", "playSound"]));
  });
});
