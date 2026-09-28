import { describe, expect, it } from "vitest";
import { PHONE_SLOTS, SCENE_LAYOUTS, angleOfPhoneSlot, phoneSlotOfAngle, type PhoneSlot, type SceneLayout } from "@xtreme/contracts";
import {
  PHONE_SHOTS,
  PHONE_SLOT_CHOICES,
  PICKS,
  cameraIdentityOf,
  cornerShows,
  isCameraIdentity,
  phoneOnScreen,
  phoneShotOf,
  phoneShotWords,
  placePhone,
  tilesBeside,
  viewPhone,
} from "../../../lib/angles";
import { readScene } from "../../../lib/scene";

/**
 * The phone as a camera (lib/angles.ts — a web helper tested here, like
 * lib/qr.ts): where the host's placement puts the phone in each layout, what
 * a viewer sees under their own pick, and how sharp each camera is fetched.
 * Only what's on screen comes in sharp; a phone that isn't on screen isn't
 * fetched at all.
 */

describe("the phone cam's identity", () => {
  it("names the phone cam by the host's account, and knows one when it sees it", () => {
    expect(cameraIdentityOf("64f0c2a1b2c3d4e5f6a7b8c9")).toBe("cam-64f0c2a1b2c3d4e5f6a7b8c9");
    expect(isCameraIdentity("cam-64f0c2a1b2c3d4e5f6a7b8c9")).toBe(true);
    for (const other of ["64f0c2a1b2c3d4e5f6a7b8c9", "obs-64f0c2a1b2c3d4e5f6a7b8c9", "mon-x", "prod-x", "guest-abc", "camera"]) {
      expect(isCameraIdentity(other), other).toBe(false);
    }
  });
});

describe("placing the phone in a layout", () => {
  it("keeps the older angle in step: main, phone and both are off, main and beside", () => {
    expect(phoneSlotOfAngle("main")).toBe("off");
    expect(phoneSlotOfAngle("phone")).toBe("main");
    expect(phoneSlotOfAngle("both")).toBe("beside");
    expect(phoneSlotOfAngle(undefined)).toBe("off");
    for (const angle of ["main", "phone", "both"] as const) expect(angleOfPhoneSlot(phoneSlotOfAngle(angle))).toBe(angle);
    // The corner has no older word: an older client sees the main camera.
    expect(angleOfPhoneSlot("corner")).toBe("main");
  });

  it("puts the phone over the host's picture, beside it, or in the corner", () => {
    expect(placePhone("off", "auto")).toEqual({ cell: false, beside: false, corner: false });
    expect(placePhone("main", "solo")).toEqual({ cell: true, beside: false, corner: false });
    expect(placePhone("beside", "split")).toEqual({ cell: false, beside: true, corner: false });
    expect(placePhone("corner", "screen-face")).toEqual({ cell: false, beside: false, corner: true });
  });

  it("makes the phone the face in Chart + face, whether it has the host's picture or the corner", () => {
    expect(placePhone("main", "chart-face")).toEqual({ cell: false, beside: false, corner: true });
    expect(placePhone("corner", "chart-face")).toEqual({ cell: false, beside: false, corner: true });
    expect(placePhone("beside", "chart-face").corner).toBe(false);
  });

  it("shows the corner only while the host has the frame, never in Solo — and always in Chart + face", () => {
    expect(cornerShows("screen-face", 0)).toBe(true);
    expect(cornerShows("auto", 0)).toBe(true);
    expect(cornerShows("auto", 1)).toBe(false);
    expect(cornerShows("solo", 0)).toBe(false);
    expect(cornerShows("chart-face", 0)).toBe(true);
  });

  it("gives the phone a seat beside the host where the layout has room, first of all", () => {
    // Alone with the phone beside: a split in Auto, Split, Trio and Grid.
    for (const layout of ["auto", "split", "trio", "grid"] as const) expect(tilesBeside(layout, 0, "beside"), layout).toBe(1);
    // No room beside the host in these.
    for (const layout of ["solo", "screen-face", "chart-face"] as const) expect(tilesBeside(layout, 2, "beside"), layout).toBe(0);
    // Split is the host and one: the phone, over a guest.
    expect(tilesBeside("split", 2, "beside")).toBe(1);
    expect(tilesBeside("trio", 2, "beside")).toBe(2);
    expect(tilesBeside("grid", 5, "beside")).toBe(3);
    // Not beside: the others are what they were.
    expect(tilesBeside("split", 2, "corner")).toBe(1);
    expect(tilesBeside("auto", 2, "off")).toBe(2);
  });

  it("keeps the phone out of a battle's split: its sides own the frame", () => {
    expect(tilesBeside("split", 1, "beside", true)).toBe(1);
    expect(phoneOnScreen("beside", "split", 1, true)).toBe(false);
    // Over the host's own picture, it still shows.
    expect(phoneOnScreen("main", "split", 1, true)).toBe(true);
  });

  it("knows when the phone is on screen at all", () => {
    expect(phoneOnScreen("off", "auto")).toBe(false);
    expect(phoneOnScreen("main", "solo")).toBe(true);
    expect(phoneOnScreen("beside", "solo")).toBe(false);
    expect(phoneOnScreen("beside", "screen-face")).toBe(false);
    expect(phoneOnScreen("corner", "screen-face")).toBe(true);
    expect(phoneOnScreen("corner", "solo")).toBe(false);
    // A guest on stage takes the frame from the corner.
    expect(phoneOnScreen("corner", "auto", 1)).toBe(false);
    expect(phoneOnScreen("corner", "chart-face", 3)).toBe(true);
  });

  it("covers every layout and placement without a gap", () => {
    for (const layout of SCENE_LAYOUTS as readonly SceneLayout[]) {
      for (const slot of PHONE_SLOTS as readonly PhoneSlot[]) {
        const place = placePhone(slot, layout);
        // At most one place at a time.
        expect(Number(place.cell) + Number(place.beside) + Number(place.corner), `${layout}/${slot}`).toBeLessThanOrEqual(1);
        if (slot === "off") expect(phoneOnScreen(slot, layout), layout).toBe(false);
      }
    }
  });
});

describe("the phone shots", () => {
  it("are one tap each to the classic framings", () => {
    const byId = Object.fromEntries(PHONE_SHOTS.map((s) => [s.id, s]));
    expect(byId.phone).toMatchObject({ layout: "solo", slot: "main" });
    expect(byId.side).toMatchObject({ layout: "split", slot: "beside" });
    // Screen + face with the phone as the face.
    expect(byId.corner).toMatchObject({ layout: "screen-face", slot: "corner" });
    expect(byId.swap).toMatchObject({ layout: "screen-face", slot: "main", needsCamera: true });
    expect(byId.off).toMatchObject({ layout: null, slot: "off" });
  });

  it("put the phone on screen, every one but Not shown", () => {
    for (const shot of PHONE_SHOTS) {
      if (shot.id === "off") continue;
      expect(phoneOnScreen(shot.slot, shot.layout!), shot.id).toBe(true);
    }
  });

  it("knows which shot a scene is on, and when it's framed some other way", () => {
    expect(phoneShotOf("screen-face", "corner")).toBe("corner");
    expect(phoneShotOf("split", "beside")).toBe("side");
    expect(phoneShotOf("grid", "off")).toBe("off");
    expect(phoneShotOf("trio", "beside")).toBeNull();
  });

  it("names the corner the face when a screen has the picture", () => {
    expect(phoneShotWords("corner", { sharing: true }).label).toBe("Screen + phone");
    expect(phoneShotWords("corner").label).toBe("Phone in corner");
    expect(phoneShotWords("swap", { crew: true }).hint).toContain("their camera");
    for (const shot of PHONE_SHOTS) {
      const words = phoneShotWords(shot.id);
      expect(words.label.length, shot.id).toBeGreaterThan(0);
      expect(words.hint.length, shot.id).toBeGreaterThan(0);
    }
  });

  it("lists the four placements and the four picks, Off and Director first", () => {
    expect(PHONE_SLOT_CHOICES.map((c) => c.id)).toEqual(["off", "main", "beside", "corner"]);
    expect(PICKS.map((p) => p.id)).toEqual(["director", "main", "phone", "split"]);
  });
});

describe("what a viewer sees", () => {
  it("follows the host under Director, layout and placement", () => {
    expect(viewPhone({ layout: "auto", phoneSlot: "off" }, "director")).toEqual({ slot: "off", layout: "auto", main: "high", phone: "off" });
    expect(viewPhone({ layout: "solo", phoneSlot: "main" }, "director")).toEqual({ slot: "main", layout: "solo", main: "low", phone: "high" });
    expect(viewPhone({ layout: "split", phoneSlot: "beside" }, "director")).toEqual({ slot: "beside", layout: "split", main: "medium", phone: "medium" });
    // Screen + face with the phone as the face: the screen stays sharp, the phone at a corner's size.
    expect(viewPhone({ layout: "screen-face", phoneSlot: "corner" }, "director")).toEqual({ slot: "corner", layout: "screen-face", main: "high", phone: "medium" });
    // The phone big, the host's camera in the corner: a size up from the smallest.
    expect(viewPhone({ layout: "screen-face", phoneSlot: "main" }, "director")).toMatchObject({ main: "medium", phone: "high" });
  });

  it("doesn't fetch a phone the layout has no room for", () => {
    expect(viewPhone({ layout: "screen-face", phoneSlot: "beside" }, "director")).toEqual({ slot: "beside", layout: "screen-face", main: "high", phone: "off" });
    expect(viewPhone({ layout: "solo", phoneSlot: "corner" }, "director")).toMatchObject({ phone: "off", main: "high" });
  });

  it("pins what the viewer picked, whatever the host placed", () => {
    for (const phoneSlot of PHONE_SLOTS) {
      const host = { layout: "screen-face" as const, phoneSlot };
      expect(viewPhone(host, "main")).toEqual({ slot: "off", layout: "screen-face", main: "high", phone: "off" });
      expect(viewPhone(host, "phone")).toMatchObject({ slot: "main", layout: "screen-face", phone: "high" });
      // Split is both side by side, with everyone else on stage too.
      expect(viewPhone(host, "split")).toEqual({ slot: "beside", layout: "auto", main: "medium", phone: "medium" });
    }
  });

  it("shows only the main camera when there's no phone in the room", () => {
    for (const pick of ["director", "main", "phone", "split"] as const) {
      expect(viewPhone({ layout: "split", phoneSlot: "beside" }, pick, false)).toEqual({ slot: "off", layout: "split", main: "high", phone: "off" });
    }
  });
});

describe("reading the placement off the wire", () => {
  it("takes the placement when it's there, and the angle from an API before placements", () => {
    expect(readScene({ layout: "screen-face", phoneSlot: "corner", angle: "main" })).toMatchObject({ phoneSlot: "corner", angle: "main" });
    expect(readScene({ layout: "auto", angle: "both" })).toMatchObject({ phoneSlot: "beside", angle: "both" });
    expect(readScene({ layout: "auto", angle: "phone" })).toMatchObject({ phoneSlot: "main", angle: "phone" });
    expect(readScene({ layout: "auto" })).toMatchObject({ phoneSlot: "off", angle: "main" });
    // Something this build doesn't know reads as the angle's, then as off.
    expect(readScene({ layout: "auto", phoneSlot: "ceiling", angle: "wide" })).toMatchObject({ phoneSlot: "off", angle: "main" });
  });
});
