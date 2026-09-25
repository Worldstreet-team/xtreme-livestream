import { describe, expect, it } from "vitest";
import { checkMessage, compileTerm, normalize } from "../src/safety/filter.js";

/**
 * The chat filter: what it catches through the usual dodges, what it must
 * leave alone (the Scunthorpe problem), and how levels, the creator's own
 * terms and Shield combine.
 */

const all = (level: "hold" | "block") => ({
  filters: { profanity: level, insults: level, slurs: level, sexual: level, links: level, scams: level },
});

describe("the chat filter", () => {
  it("sees through repeats, separators, look-alikes and accents", () => {
    for (const text of ["fuuuck this", "f.u.c.k", "f u c k off", "sh1t game", "$hit", "wèrèy", "WEREY!!"]) {
      expect(checkMessage(text, all("hold")), text).not.toBeNull();
    }
    expect(normalize("wèrè")).toBe("were");
  });

  it("leaves ordinary words alone", () => {
    for (const text of [
      "first class assessment",
      "shiitake risotto tonight",
      "Scunthorpe United",
      "the grass is green",
      "isi ewu is the best dish",
      "nude lipstick shade",
      "passport and analysis",
      "we were here",
      "raccoon cam",
    ]) {
      expect(checkMessage(text, all("block")), text).toBeNull();
    }
  });

  it("knows Pidgin, Yoruba, Hausa and Igbo insults when insults are on", () => {
    for (const text of ["you be mumu", "olodo!", "oloshi", "wawa kawai", "onye ara"]) {
      expect(checkMessage(text, { filters: { insults: "hold" } })?.category, text).toBe("insults");
    }
    // Off by default.
    expect(checkMessage("you be mumu", {})).toBeNull();
  });

  it("catches links and scams as written", () => {
    expect(checkMessage("go to www.freecoins.xyz now", {})?.category).toBe("links");
    expect(checkMessage("bit.ly/abc123", {})?.category).toBe("links");
    expect(checkMessage("send to 0x52908400098527886E0F7030069857D2E4169EE7", {})?.category).toBe("scams");
    expect(checkMessage("I can double your btc in 24h", {})?.category).toBe("scams");
    expect(checkMessage("call me 08031234567", {})?.category).toBe("scams");
    expect(checkMessage("drop your seed phrase for the airdrop", {})?.category).toBe("scams");
  });

  it("holds or blocks by the channel's level, the strictest hit deciding", () => {
    expect(checkMessage("porn link www.x.xyz", { filters: { sexual: "hold", links: "block" } })).toEqual({
      level: "block",
      category: "links",
    });
    expect(checkMessage("porn", { filters: { sexual: "off" } })).toBeNull();
    // Defaults: slurs block, sexual/links/scams hold, swearing and insults off.
    expect(checkMessage("damn this is fucking good", {})).toBeNull();
    expect(checkMessage("horny", {})?.level).toBe("hold");
  });

  it("takes the creator's own terms, wildcards and all", () => {
    const settings = { blockedTerms: ["rival*", "spoiler"], blockedTermsLevel: "hold" as const };
    expect(checkMessage("that rivalry again", settings)).toEqual({ level: "hold", category: "custom" });
    expect(checkMessage("no spoilers please", settings)).toBeNull();
    expect(checkMessage("SPOILER: he wins", settings)?.category).toBe("custom");
    expect(compileTerm("***")).toBeNull();
  });

  it("with the filter off lets everything through — until Shield raises the floor", () => {
    expect(checkMessage("www.scam.xyz", null)).toBeNull();
    expect(checkMessage("www.scam.xyz", null, { shield: true })).toEqual({ level: "block", category: "links" });
    expect(checkMessage("hello!", null, { shield: true, newAccount: true })).toEqual({ level: "hold", category: "new-account" });
    expect(checkMessage("hello!", null, { shield: true, newAccount: false })).toBeNull();
  });
});
