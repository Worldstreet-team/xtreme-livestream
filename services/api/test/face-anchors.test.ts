import { describe, expect, it } from "vitest";
import {
  ANCHOR_BYTES,
  ANCHOR_VERSION,
  ANCHORS_TOPIC,
  AnchorFeed,
  FACE_BUDGET_MS,
  FACE_MAX_HZ,
  adaptRate,
  anchorsListener,
  decodeAnchors,
  encodeAnchors,
  fallbackFace,
  frameBox,
  lerpFace,
  mapFace,
  reduceLandmarks,
  toTile,
  visibleBox,
  wrapAngle,
  type FaceAnchors,
} from "../../../lib/face-anchors";

/**
 * Face anchors (Phase 4, Sets): the host's browser boils its face down to a
 * few points and sends them as a small binary packet on the room's lossy
 * channel; viewers put them back on their own tile — whatever its crop, and
 * mirrored where the picture is — and glide between packets.
 */

const FACE: FaceAnchors = {
  cx: 0.52,
  cy: 0.41,
  w: 0.31,
  h: 0.42,
  eyes: [
    { x: 0.46, y: 0.36 },
    { x: 0.58, y: 0.37 },
  ],
  mouth: { x: 0.52, y: 0.52 },
  roll: 0.08,
};

const close = (a: number, b: number, within = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(within);

describe("the anchors packet", () => {
  it("carries a face in 28 bytes — under the 32 the channel's given", () => {
    const bytes = encodeAnchors({ seq: 5, t: 1234.4, aspect: 16 / 9, face: FACE });

    expect(bytes.byteLength).toBe(ANCHOR_BYTES);
    expect(bytes.byteLength).toBeLessThanOrEqual(32);
    expect(bytes[0] >> 4).toBe(ANCHOR_VERSION);
    expect(bytes[0] & 1).toBe(1);
  });

  it("comes back as it went, to a small fraction of a pixel", () => {
    const back = decodeAnchors(encodeAnchors({ session: 5, seq: 200, t: 70_000.2, aspect: 16 / 9, face: FACE }));

    expect(back).not.toBeNull();
    expect(back!.session).toBe(5);
    expect(back!.seq).toBe(200);
    // The clock wraps at 65 536 ms.
    expect(back!.t).toBe(Math.round(70_000.2) % 65536);
    close(back!.aspect, 16 / 9, 1e-4);
    const f = back!.face!;
    for (const [a, b] of [
      [f.cx, FACE.cx],
      [f.cy, FACE.cy],
      [f.w, FACE.w],
      [f.h, FACE.h],
      [f.eyes[0].x, FACE.eyes[0].x],
      [f.eyes[1].y, FACE.eyes[1].y],
      [f.mouth.x, FACE.mouth.x],
      [f.mouth.y, FACE.mouth.y],
    ]) {
      close(a, b, 1 / 16384);
    }
    close(f.roll, FACE.roll, 1e-4);
  });

  it("says there's no face in six bytes", () => {
    const bytes = encodeAnchors({ seq: 1, t: 10, aspect: 9 / 16, face: null });

    expect(bytes.byteLength).toBe(6);
    const back = decodeAnchors(bytes)!;
    expect(back.face).toBeNull();
    close(back.aspect, 9 / 16, 1e-4);
  });

  it("keeps points just off the frame, and pins wild ones to its range", () => {
    const off = { ...FACE, eyes: [{ x: -0.1, y: 0.3 }, { x: 1.2, y: 0.3 }] as FaceAnchors["eyes"] };
    const back = decodeAnchors(encodeAnchors({ seq: 0, t: 0, aspect: 1, face: off }))!.face!;
    close(back.eyes[0].x, -0.1, 1 / 16384);
    close(back.eyes[1].x, 1.2, 1 / 16384);

    const wild = decodeAnchors(encodeAnchors({ seq: 0, t: 0, aspect: 1, face: { ...FACE, cx: 9, cy: Number.NaN, roll: 7 } }))!.face!;
    expect(wild.cx).toBeLessThan(2);
    expect(wild.cy).toBe(0);
    close(wild.roll, wrapAngle(7), 1e-4);
  });

  it("reads a longer packet from a newer build as far as it knows, and refuses what isn't one", () => {
    const longer = new Uint8Array(32);
    longer.set(encodeAnchors({ seq: 3, t: 99, aspect: 4 / 3, face: FACE }));
    expect(decodeAnchors(longer)?.face).not.toBeNull();

    expect(decodeAnchors(new Uint8Array(3))).toBeNull();
    const wrongVersion = encodeAnchors({ seq: 3, t: 99, aspect: 1, face: FACE });
    wrongVersion[0] = (2 << 4) | 1;
    expect(decodeAnchors(wrongVersion)).toBeNull();
    // Says it has a face but was cut short.
    expect(decodeAnchors(encodeAnchors({ seq: 3, t: 99, aspect: 1, face: FACE }).slice(0, 20))).toBeNull();
    // JSON someone else sent on the topic.
    expect(decodeAnchors(new TextEncoder().encode('{"__evt":"x"}'))).toBeNull();
  });
});

describe("the host's pace", () => {
  it("looks a dozen times a second at most, fewer on a device that can't keep up, three at least", () => {
    expect(FACE_MAX_HZ).toBeLessThanOrEqual(12);
    let hz = FACE_MAX_HZ;
    for (let i = 0; i < 40; i++) hz = adaptRate(hz, FACE_BUDGET_MS + 12);
    expect(hz).toBe(3);
    // Comfortable again: back up, but no further than the most.
    for (let i = 0; i < 60; i++) hz = adaptRate(hz, 8);
    expect(hz).toBe(FACE_MAX_HZ);
    // In between, it holds.
    expect(adaptRate(7, FACE_BUDGET_MS - 5)).toBe(7);
  });
});

describe("from landmarks", () => {
  /** 478 points, with the ones the reduction reads placed for an upright face. */
  const mesh = (place: (i: number) => { x: number; y: number } | null) =>
    Array.from({ length: 478 }, (_, i) => place(i) ?? { x: 0.5, y: 0.5 });
  const upright: Record<number, { x: number; y: number }> = {
    33: { x: 0.4, y: 0.4 },
    133: { x: 0.46, y: 0.4 },
    159: { x: 0.43, y: 0.39 },
    145: { x: 0.43, y: 0.41 },
    362: { x: 0.54, y: 0.4 },
    263: { x: 0.6, y: 0.4 },
    386: { x: 0.57, y: 0.39 },
    374: { x: 0.57, y: 0.41 },
    13: { x: 0.5, y: 0.55 },
    14: { x: 0.5, y: 0.57 },
    61: { x: 0.46, y: 0.56 },
    291: { x: 0.54, y: 0.56 },
    234: { x: 0.36, y: 0.45 },
    454: { x: 0.64, y: 0.45 },
    10: { x: 0.5, y: 0.25 },
    152: { x: 0.5, y: 0.65 },
  };

  it("finds the eyes, the mouth, the face's size and no tilt on an upright face", () => {
    const f = reduceLandmarks(
      mesh((i) => upright[i] ?? null),
      1
    )!;

    close(f.eyes[0].x, 0.43);
    close(f.eyes[1].x, 0.57);
    close(f.mouth.y, 0.56);
    close(f.w, 0.28);
    close(f.h, 0.4);
    close(f.roll, 0);
    close(f.cx, 0.5);
  });

  it("measures a face the same on a wide frame, and reads a tilt", () => {
    const aspect = 16 / 9;
    // The same face on a 16:9 frame: x fractions shrink by the aspect about the middle.
    const wide = mesh((i) => (upright[i] ? { x: 0.5 + (upright[i].x - 0.5) / aspect, y: upright[i].y } : null));
    const f = reduceLandmarks(wide, aspect)!;
    close(f.w, 0.28);
    close(f.roll, 0);

    // Tilted 10° clockwise about the face's middle.
    const a = (10 * Math.PI) / 180;
    const tilted = mesh((i) => {
      const p = upright[i];
      if (!p) return null;
      const dx = p.x - 0.5;
      const dy = p.y - 0.45;
      return { x: 0.5 + dx * Math.cos(a) - dy * Math.sin(a), y: 0.45 + dx * Math.sin(a) + dy * Math.cos(a) };
    });
    const t = reduceLandmarks(tilted, 1)!;
    close(t.roll, a, 1e-6);
    close(t.w, 0.28, 1e-6);
  });

  it("gives nothing for too few points", () => {
    expect(reduceLandmarks([{ x: 0.5, y: 0.5 }], 1)).toBeNull();
    expect(reduceLandmarks(undefined, 1)).toBeNull();
  });
});

describe("onto a tile", () => {
  it("fits a frame of the tile's own shape exactly", () => {
    expect(frameBox(16 / 9, 1280, 720, "cover")).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(frameBox(16 / 9, 1280, 720, "contain")).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    const g = mapFace(FACE, 16 / 9, 1280, 720, "cover");
    close(g.cx, 0.52 * 1280);
    close(g.cy, 0.41 * 720);
    close(g.fw, 0.31 * 720);
  });

  it("covers: a wide frame on an upright phone tile is cropped at the sides, not squashed", () => {
    // 1280×720 into 390×844: scaled to 844 tall, 1500.4 wide, 555.2 cut off each side.
    const box = frameBox(16 / 9, 390, 844, "cover");
    close(box.h, 844);
    close(box.w, (844 * 16) / 9);
    close(box.x, (390 - (844 * 16) / 9) / 2);
    expect(box.y).toBe(0);
    const g = mapFace(FACE, 16 / 9, 390, 844, "cover");
    close(g.cx, box.x + 0.52 * box.w);
    close(g.cy, 0.41 * 844);
    // Sizes are in frame heights, so they scale with the drawn height.
    close(g.fw, 0.31 * 844);
    close(g.fh, 0.42 * 844);
    expect(visibleBox(box, 390, 844)).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  });

  it("contains: an upright frame on a wide tile is pillarboxed, the face with it", () => {
    const box = frameBox(9 / 16, 1280, 720, "contain");
    close(box.w, 405);
    close(box.x, (1280 - 405) / 2);
    const g = mapFace(FACE, 9 / 16, 1280, 720, "contain");
    close(g.cx, box.x + 0.52 * 405);
    close(g.fw, 0.31 * 720);
    const vis = visibleBox(box, 1280, 720);
    close(vis.x, box.x);
    close(vis.w, 405);
  });

  it("mirrors: x flips across the tile and the tilt turns the other way", () => {
    const plain = mapFace(FACE, 16 / 9, 1280, 720, "cover");
    const mirrored = mapFace(FACE, 16 / 9, 1280, 720, "cover", true);
    close(mirrored.cx, 1280 - plain.cx);
    close(mirrored.ex, 1280 - plain.ex);
    close(mirrored.mx, 1280 - plain.mx);
    close(mirrored.cy, plain.cy);
    close(mirrored.roll, -plain.roll);
    close(mirrored.ed, plain.ed);
    // And a lone point mirrors about the tile, not the frame, when the frame overhangs.
    const box = frameBox(16 / 9, 390, 844, "cover");
    close(toTile({ x: 0.25, y: 0.5 }, box, 390, true).x, 390 - toTile({ x: 0.25, y: 0.5 }, box, 390).x);
  });

  it("sits centre-frame when no face is known", () => {
    const g = fallbackFace(visibleBox(frameBox(9 / 16, 1280, 720, "contain"), 1280, 720));
    expect(g.known).toBe(false);
    close(g.cx, 640);
    expect(g.cy).toBeLessThan(360);
    expect(g.roll).toBe(0);
    // Face-sized for what's showing, not for the black bars.
    expect(g.fw).toBeLessThan(405 * 0.5);
  });
});

describe("the viewer's feed", () => {
  const packet = (t: number, cx: number, session = 3) => encodeAnchors({ session, seq: 0, t, aspect: 16 / 9, face: { ...FACE, cx } });

  it("glides between packets, a little in the past", () => {
    const feed = new AnchorFeed();
    feed.push(packet(1000, 0.2), 5000);
    feed.push(packet(1100, 0.4), 5100);
    feed.push(packet(1200, 0.6), 5200);

    // 150 ms back from 5200: half-way between the packets sent at 1000 and 1100 … plus 50.
    close(feed.sample(150, 5200).face!.cx, 0.3, 1e-3);
    close(feed.sample(100, 5200).face!.cx, 0.4, 1e-3);
    // Past the newest: it holds the newest.
    close(feed.sample(0, 5260).face!.cx, 0.6, 1e-3);
    expect(feed.aspect).toBeCloseTo(16 / 9, 3);
  });

  it("times packets by the host's clock, not by when a slow one happened to land", () => {
    const feed = new AnchorFeed();
    feed.push(packet(1000, 0.2), 5000);
    // Sent 100 ms later but held up 60 ms on the way.
    feed.push(packet(1100, 0.4), 5160);
    feed.push(packet(1200, 0.6), 5200);
    // Mid-way on the host's clock is still mid-way.
    close(feed.sample(0, 5050).face!.cx, 0.3, 1e-3);
  });

  it("drops repeats and late packets, and starts over when the host does", () => {
    const feed = new AnchorFeed();
    expect(feed.push(packet(1000, 0.2), 5000)).toBe(true);
    expect(feed.push(packet(1000, 0.2), 5001)).toBe(false);
    expect(feed.push(packet(1100, 0.4), 5100)).toBe(true);
    // Late: sent before the last one we used.
    expect(feed.push(packet(1050, 0.9), 5120)).toBe(false);
    expect(feed.dropped).toBe(2);
    // A reload: a new session, and the host's clock starts near zero again.
    expect(feed.push(packet(12, 0.7, 6), 5200)).toBe(true);
    close(feed.sample(0, 5200).face!.cx, 0.7, 1e-3);
    // Even on the same session, a clock that jumped lands on the newest face.
    const same = new AnchorFeed();
    same.push(packet(40_000, 0.2), 5000);
    expect(same.push(packet(900, 0.5), 5100)).toBe(true);
    close(same.sample(0, 5100).face!.cx, 0.5, 1e-3);
  });

  it("keeps up when the path gets slower for good", () => {
    const feed = new AnchorFeed();
    feed.push(packet(1000, 0.2), 5000);
    feed.push(packet(1100, 0.3), 5100);
    // From here on everything arrives a second later than before.
    feed.push(packet(1200, 0.4), 6200);
    feed.push(packet(1300, 0.6), 6300);
    close(feed.sample(50, 6300).face!.cx, 0.5, 1e-3);
  });

  it("follows the host's clock across its wrap at 65 536 ms", () => {
    const feed = new AnchorFeed();
    feed.push(packet(65_500, 0.2), 9000);
    feed.push(packet(64, 0.4), 9100);
    close(feed.sample(50, 9100).face!.cx, 0.3, 1e-3);
  });

  it("lets go of a face that's gone quiet, or that the host says is gone", () => {
    const feed = new AnchorFeed();
    feed.push(packet(1000, 0.2), 5000);
    expect(feed.sample(0, 5100).face).not.toBeNull();
    expect(feed.sample(0, 5000 + 1600).face).toBeNull();

    const told = new AnchorFeed();
    told.push(packet(3000, 0.2), 8000);
    told.push(encodeAnchors({ session: 3, seq: 1, t: 3100, aspect: 16 / 9, face: null }), 8100);
    expect(told.sample(0, 8150).face).toBeNull();
    expect(told.sample(100, 8150).face).not.toBeNull();
  });

  it("refuses what isn't a packet without losing what it had", () => {
    const feed = new AnchorFeed();
    feed.push(packet(1000, 0.2), 5000);
    expect(feed.push(new TextEncoder().encode("hello"), 5010)).toBe(false);
    expect(feed.sample(0, 5010).face).not.toBeNull();
  });

  it("takes the host's own detections straight, for their preview", () => {
    const feed = new AnchorFeed();
    feed.put({ ...FACE, cx: 0.2 }, 16 / 9, 100);
    feed.put({ ...FACE, cx: 0.4 }, 16 / 9, 183);
    close(feed.sample(41.5, 183).face!.cx, 0.3, 1e-3);
  });

  it("takes the host's packets off the room, ignores anyone else's, and keeps them out of the JSON path", () => {
    const feed = new AnchorFeed();
    const onData = anchorsListener(feed, () => "host-7");
    const bytes = packet(1000, 0.2);

    expect(onData(bytes, { identity: "host-7" }, 1, ANCHORS_TOPIC)).toBe(true);
    expect(feed.received).toBe(1);
    // A guest can't move the host's crown.
    expect(onData(packet(1100, 0.9), { identity: "guest-2" }, 1, ANCHORS_TOPIC)).toBe(true);
    expect(feed.received).toBe(1);
    // Everything else carries on to the room's own events.
    expect(onData(new TextEncoder().encode('{"__evt":"scene"}'), { identity: "host-7" }, 1, undefined)).toBe(false);
    expect(onData(bytes, { identity: "host-7" }, 1, "chat")).toBe(false);
  });

  it("turns the short way round between tilts", () => {
    const a = { ...FACE, roll: Math.PI - 0.1 };
    const b = { ...FACE, roll: -Math.PI + 0.1 };
    close(Math.abs(wrapAngle(lerpFace(a, b, 0.5).roll)), Math.PI, 1e-9);
  });
});
