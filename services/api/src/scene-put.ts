import type mongoose from "mongoose";
import type { SceneLayer, Scene as SceneWire } from "@xtreme/contracts";
import { cardMoment, recordMoment } from "./analytics.js";
import { ApiError } from "./errors.js";
import { sceneView } from "./featured.js";
import { sendRoomData, setRoomScene } from "./livekit.js";
import { Stream } from "./models.js";
import { resolveSceneLayers, sponsorLayerOf, trackSponsorExposure } from "./sponsors.js";

/**
 * The one way a whole scene is written (the studio's and a console's
 * PUT, and a Stream Deck's Next when a segment brings a sponsor up): the
 * sponsor card is drawn from our records, the write lands only if nobody
 * changed the scene in between (a show rule, another hand), the room is
 * told, and a sponsor's on-screen time is kept. Three tries, then 409.
 */

type Id = mongoose.Types.ObjectId | string;

/** What a client sends: the scene without the fields only the API sets. */
export type SceneBody = Omit<SceneWire, "version" | "featured">;

export async function putScene(streamId: Id, body: SceneBody, now = new Date()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stream = await Stream.findById(streamId).select("streamerId isLive category scene livekitRoomName").lean();
    if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
    if (!stream.isLive) throw new ApiError(409, "Go live first", "NOT_LIVE");
    // A sponsor card is drawn from our records, never from what was sent —
    // and it's always the host's sponsor, whoever is producing.
    const layers = await resolveSceneLayers(body.layers as SceneLayer[], stream.streamerId, stream, now);
    const sponsorBefore = sponsorLayerOf(stream.scene?.layers);
    const cardBefore = stream.scene?.card ?? null;
    const expected = stream.scene?.version ?? 0;
    const updated = await Stream.findOneAndUpdate(
      {
        _id: stream._id,
        isLive: true,
        // The version we read: a scene nobody has written yet may not carry one.
        ...(expected ? { "scene.version": expected } : { $or: [{ "scene.version": 0 }, { "scene.version": { $exists: false } }] }),
      },
      {
        $set: {
          "scene.layout": body.layout,
          "scene.card": body.card,
          "scene.cardNote": body.cardNote,
          "scene.chart": body.chart,
          "scene.layers": layers,
          "scene.gains": body.gains,
          "scene.spotlight": body.spotlight,
          "scene.interpreter": body.interpreter,
          // Optional on the wire: a client that doesn't know about the phone
          // cam sends no angle, and must not knock the phone off the program.
          "scene.angle": body.angle ?? stream.scene?.angle ?? "main",
        },
        $inc: { "scene.version": 1 },
      },
      { new: true, select: "scene livekitRoomName" },
    ).lean();
    if (!updated) continue;
    const scene = sceneView(updated.scene);
    await setRoomScene(updated.livekitRoomName, scene);
    void sendRoomData(updated.livekitRoomName, { __evt: "scene", scene });
    // A card going up is a moment in the recap (analytics.ts).
    if (scene.card && scene.card !== cardBefore) void recordMoment(stream._id, "card", cardMoment(scene.card), now);
    // The sponsor's on-screen time: what campaigns pay on, and what
    // sponsored quests count against. Never fails the write.
    await trackSponsorExposure(stream, sponsorBefore, sponsorLayerOf(layers), now).catch((e) => console.error("sponsor exposure tracking failed:", e));
    return scene;
  }
  throw new ApiError(409, "The scene changed just now — try again", "SCENE_MOVED");
}
