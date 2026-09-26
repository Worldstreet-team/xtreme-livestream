import { describe, expect, it } from "vitest";
import { RULE_SOUNDS, SCENE_CARDS, SCENE_LAYOUTS, controlDoBodySchema, controlShowBodySchema } from "@xtreme/contracts";
import { CARDS, LAYOUTS, PADS, calls, failureText, toRequest } from "../../../packages/control-mcp/src/calls.ts";

/**
 * The MCP server's side of the control API: each tool becomes the request
 * the API takes — checked against the API's own schemas — and the API's
 * refusals are said for the tool that met them.
 */

describe("the control MCP server's calls", () => {
  it("keeps its unions the API's", () => {
    expect([...LAYOUTS]).toEqual([...SCENE_LAYOUTS]);
    expect([...CARDS]).toEqual([...SCENE_CARDS]);
    expect([...PADS]).toEqual([...RULE_SOUNDS]);
  });

  it("maps each tool to what the API takes", () => {
    expect(calls.state()).toMatchObject({ method: "GET", path: "/control/state" });
    expect(calls.show("next")).toMatchObject({ method: "POST", path: "/control/show", body: { step: "next" } });
    expect(calls.fireRule("64f1c0ffee0000000000abcd")).toMatchObject({ method: "POST", path: "/control/rules/64f1c0ffee0000000000abcd/fire" });
    expect(calls.fireRule("../admin").path).toBe("/control/rules/..%2Fadmin/fire");

    expect(calls.card("brb").body).toEqual({ actions: [{ do: "card", card: "brb" }] });
    expect(calls.card(null).body).toEqual({ actions: [{ do: "card", card: null }] });
    expect(calls.card("starting-soon", 30).body).toEqual({ actions: [{ do: "card", card: "starting-soon", seconds: 30 }] });
    expect(calls.lowerThird("Ada K", "Guest").body).toEqual({ actions: [{ do: "lower_third", title: "Ada K", subtitle: "Guest" }] });
    expect(calls.lowerThird("Tolu", undefined, 20).body).toEqual({ actions: [{ do: "lower_third", title: "Tolu", seconds: 20 }] });
    expect(calls.banner("Kolanut Coffee — code KEMI", 60).body).toEqual({ actions: [{ do: "banner", text: "Kolanut Coffee — code KEMI", seconds: 60 }] });
    expect(calls.layout("split").body).toEqual({ actions: [{ do: "layout", layout: "split" }] });
    expect(calls.sound("airhorn").body).toEqual({ actions: [{ do: "sound", pad: "airhorn" }] });
    expect(calls.do([{ do: "hide", graphic: "banner" }, { do: "countdown", minutes: 5, label: "Back in" }]).body).toEqual({
      actions: [{ do: "hide", graphic: "banner" }, { do: "countdown", minutes: 5, label: "Back in" }],
    });
  });

  it("sends bodies the API's schemas accept, defaults and all", () => {
    for (const call of [
      calls.card("brb"),
      calls.card(null, 10),
      calls.lowerThird("Amara Obi"),
      calls.lowerThird("Ada K", "Guest", 8),
      calls.banner("Thanks for watching"),
      calls.layout("chart-face"),
      calls.sound("kaching"),
      calls.do([{ do: "hide", graphic: "lower-third" }, { do: "countdown", minutes: 3 }]),
    ]) {
      expect(controlDoBodySchema.safeParse(call.body).success, call.what).toBe(true);
    }
    expect(controlShowBodySchema.safeParse(calls.show("start").body).success).toBe(true);
    // Defaults are the API's: a lower third stays 8 s, a banner 15, a card until it's taken down.
    const parsed = controlDoBodySchema.parse(calls.lowerThird("Ada K").body);
    expect(parsed.actions[0]).toMatchObject({ seconds: 8, subtitle: "" });
    expect(controlDoBodySchema.parse(calls.banner("Hi").body).actions[0]).toMatchObject({ seconds: 15 });
    expect(controlDoBodySchema.parse(calls.card("brb").body).actions[0]).toMatchObject({ seconds: null });
  });

  it("becomes a request with the key in the header, never the URL", () => {
    const req = toRequest("http://localhost:3002/api/", "xck_abc", calls.banner("Hello"));
    expect(req).toEqual({
      url: "http://localhost:3002/api/control/do",
      method: "POST",
      headers: { authorization: "Bearer xck_abc", accept: "application/json", "content-type": "application/json" },
      body: '{"actions":[{"do":"banner","text":"Hello"}]}',
    });
    const get = toRequest("https://api.example.com/api", "xck_abc", calls.state());
    expect(get.url).toBe("https://api.example.com/api/control/state");
    expect(get).not.toHaveProperty("body");
    expect(get.headers).not.toHaveProperty("content-type");
  });

  it("says the API's no for the tool that met it", () => {
    const scope = { code: "CONTROL_KEY_SCOPE", message: 'This key can\'t do that — give it "scene" in Settings → Stream Deck & automation' };
    expect(failureText(calls.card("brb"), 403, scope)).toBe('This key can\'t put a card up — give it "scene" in Settings → Stream Deck & automation');
    expect(failureText(calls.sound("airhorn"), 403, { ...scope, message: scope.message.replace("scene", "sound") })).toBe(
      'This key can\'t play a sound — give it "sound" in Settings → Stream Deck & automation',
    );
    expect(failureText(calls.show("next"), 409, { code: "NOT_LIVE", message: "You're not live — go live first" })).toBe("You're not live — go live first");
    expect(failureText(calls.state(), 502, "<html>bad gateway</html>")).toBe("The Xtream API answered 502");
  });
});
