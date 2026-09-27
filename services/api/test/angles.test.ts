import { describe, expect, it } from "vitest";
import { ANGLES, PICKS, cameraIdentityOf, isCameraIdentity, resolveAngle } from "../../../lib/angles";

/**
 * Viewer-chosen angles (lib/angles.ts — a web helper tested here, like
 * lib/qr.ts): what a viewer sees from the host's angle and their own pick,
 * and how sharp each camera is fetched. Only what's on screen comes in
 * sharp; a phone that isn't on screen isn't fetched at all.
 */

describe("angles", () => {
  it("names the phone cam by the host's account, and knows one when it sees it", () => {
    expect(cameraIdentityOf("64f0c2a1b2c3d4e5f6a7b8c9")).toBe("cam-64f0c2a1b2c3d4e5f6a7b8c9");
    expect(isCameraIdentity("cam-64f0c2a1b2c3d4e5f6a7b8c9")).toBe(true);
    for (const other of ["64f0c2a1b2c3d4e5f6a7b8c9", "obs-64f0c2a1b2c3d4e5f6a7b8c9", "mon-x", "prod-x", "guest-abc", "camera"]) {
      expect(isCameraIdentity(other), other).toBe(false);
    }
  });

  it("follows the host under Director", () => {
    expect(resolveAngle("main", "director")).toEqual({ show: "main", main: "high", phone: "off" });
    expect(resolveAngle("phone", "director")).toEqual({ show: "phone", main: "low", phone: "high" });
    expect(resolveAngle("both", "director")).toEqual({ show: "both", main: "medium", phone: "medium" });
  });

  it("pins what the viewer picked, whatever the host cut to", () => {
    for (const hostAngle of ["main", "phone", "both"] as const) {
      expect(resolveAngle(hostAngle, "main")).toEqual({ show: "main", main: "high", phone: "off" });
      expect(resolveAngle(hostAngle, "phone")).toEqual({ show: "phone", main: "low", phone: "high" });
      expect(resolveAngle(hostAngle, "split")).toEqual({ show: "both", main: "medium", phone: "medium" });
    }
  });

  it("shows only the main camera when there's no phone in the room", () => {
    for (const pick of ["director", "main", "phone", "split"] as const) {
      expect(resolveAngle("both", pick, false)).toEqual({ show: "main", main: "high", phone: "off" });
    }
  });

  it("lists the three angles and the four picks, Director first", () => {
    expect(ANGLES.map((a) => a.id)).toEqual(["main", "phone", "both"]);
    expect(PICKS.map((p) => p.id)).toEqual(["director", "main", "phone", "split"]);
    for (const item of [...ANGLES, ...PICKS]) expect(item.hint.length, item.id).toBeGreaterThan(0);
  });
});
