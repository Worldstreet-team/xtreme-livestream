import type { FastifyPluginAsync } from "fastify";
import type { Types } from "mongoose";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  MAX_CONTROL_KEYS,
  controlDoBodySchema,
  controlKeyBodySchema,
  controlKeyIdParamsSchema,
  controlShowBodySchema,
  ruleIdParamsSchema,
  type ControlKeyView,
  type ControlScope,
  type RuleAction,
  type SceneLayer,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { openControlFeed } from "../control-feed.js";
import { authenticateControl, newControlKey } from "../control-keys.js";
import { ApiError } from "../errors.js";
import { ControlKey, Rundown, ShowRule, Stream, type IControlKey } from "../models.js";
import { SAMPLE_WORDS, cueActions, runActions } from "../rules.js";
import { moveShow } from "./rundown.js";
import { sceneView } from "../featured.js";
import { putScene, type SceneBody } from "../scene-put.js";

/**
 * The control API (Phase 3): the studio's buttons for a Stream Deck,
 * Companion or a script — change the scene and its graphics, play a sound,
 * run the show, fire a rule — signed in with a control key rather than a
 * browser session. Nothing here moves money or touches anyone's account.
 */

const keyView = (k: Pick<IControlKey, "_id" | "name" | "scopes" | "prefix" | "createdAt" | "lastUsedAt">): ControlKeyView => ({
  id: String(k._id),
  name: k.name,
  scopes: k.scopes as ControlKeyView["scopes"],
  prefix: k.prefix,
  createdAt: new Date(k.createdAt).toISOString(),
  lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt).toISOString() : null,
});

/** A button press, or a script: generous, but not unbounded. */
const PRESS_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } };

type Segment = { id: string; title: string; seconds: number; cues?: Array<Record<string, unknown> & { do: string }> };

export const controlRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ---- Keys, from Settings (a signed-in session) ---- */

  app.get(
    "/users/me/control-keys",
    { schema: { tags: ["Control API"], summary: "Your control keys (never the keys themselves)", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const keys = await ControlKey.find({ ownerId: dbUser._id }).sort({ createdAt: 1 }).lean();
      return { success: true, data: { keys: keys.map(keyView), max: MAX_CONTROL_KEYS } };
    },
  );

  app.post(
    "/users/me/control-keys",
    {
      schema: { tags: ["Control API"], summary: "Make a control key — shown once", body: controlKeyBodySchema, security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      if ((await ControlKey.countDocuments({ ownerId: dbUser._id })) >= MAX_CONTROL_KEYS) {
        throw new ApiError(409, `That's the most keys a channel can have (${MAX_CONTROL_KEYS}) — remove one first`, "TOO_MANY_KEYS");
      }
      const { key, hash, prefix } = newControlKey();
      const saved = await ControlKey.create({ ownerId: dbUser._id, name: request.body.name, scopes: [...new Set(request.body.scopes)], hash, prefix });
      return { success: true, data: { key: keyView(saved), secret: key } };
    },
  );

  app.delete(
    "/users/me/control-keys/:keyId",
    { schema: { tags: ["Control API"], summary: "Remove a control key — it stops working at once", params: controlKeyIdParamsSchema, security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await ControlKey.deleteOne({ _id: request.params.keyId, ownerId: dbUser._id });
      return { success: true, data: { removed: true } };
    },
  );

  /* ---- Control, with a key ---- */

  const liveStreamOf = async (ownerId: Types.ObjectId) => {
    const stream = await Stream.findOne({ streamerId: ownerId, isLive: true }).select("+rundown streamerId livekitRoomName title startedAt scene").lean();
    if (!stream) throw new ApiError(409, "You're not live — go live first", "NOT_LIVE");
    return stream;
  };
  const segmentsOf = async (ownerId: Types.ObjectId) =>
    ((await Rundown.findOne({ ownerId }).select("segments").lean())?.segments ?? []) as unknown as Segment[];

  app.get(
    "/control/state",
    { schema: { tags: ["Control API"], summary: "What's on: live or not, and the scene, the show and the rules as far as the key's scopes go" }, config: PRESS_LIMIT },
    async (request) => {
      const { owner, key } = await authenticateControl(request, null);
      // Any key may ask whether the channel is live. The rest is for a key
      // that acts on it — or, for the scene, hears it on the events feed
      // anyway: an airhorn button has no business reading the run of show.
      const sees = (scope: ControlScope) => key.scopes.includes(scope) || (scope === "scene" && key.scopes.includes("events"));
      const [stream, segments, rules] = await Promise.all([
        Stream.findOne({ streamerId: owner._id, isLive: true }).select("+rundown title startedAt scene").lean(),
        sees("show") ? segmentsOf(owner._id) : null,
        sees("rules") ? ShowRule.find({ ownerId: owner._id }).select("name on when").sort({ createdAt: 1 }).lean() : null,
      ]);
      const onAirIndex = segments && stream?.rundown?.segmentId ? segments.findIndex((s) => s.id === stream.rundown?.segmentId) : -1;
      return {
        success: true,
        data: {
          live: Boolean(stream),
          stream: stream ? { id: String(stream._id), title: stream.title, startedAt: stream.startedAt } : null,
          ...(sees("scene")
            ? {
                scene: stream
                  ? { layout: stream.scene?.layout ?? "auto", card: stream.scene?.card ?? null, graphics: (stream.scene?.layers ?? []).map((l) => l.kind) }
                  : null,
              }
            : {}),
          ...(segments
            ? {
                show: {
                  segments: segments.length,
                  onAir: onAirIndex >= 0 ? segments[onAirIndex]!.title : null,
                  next: (onAirIndex >= 0 ? segments[onAirIndex + 1] : segments[0])?.title ?? null,
                },
              }
            : {}),
          ...(rules ? { rules: rules.map((r) => ({ id: String(r._id), name: r.name, on: r.on, when: (r.when as { kind: string }).kind })) } : {}),
        },
      };
    },
  );

  app.get(
    "/control/events",
    {
      schema: { tags: ["Control API"], summary: "What happens on the stream, as it happens — server-sent events (curl -N)" },
      config: PRESS_LIMIT,
    },
    async (request, reply) => {
      // Listening is its own scope: the feed carries the show as it happens,
      // which a key made for one button has no business hearing. Authenticating
      // touches lastUsedAt — once, on connect.
      const { owner } = await authenticateControl(request, "events");
      const feed = await openControlFeed(owner._id);
      try {
        // From here the reply is the feed's to write and to end: Fastify steps aside.
        reply.hijack();
        feed.serve(request.raw, reply.raw, reply.getHeaders());
      } catch (err) {
        feed.release();
        throw err;
      }
    },
  );

  app.post(
    "/control/do",
    {
      schema: { tags: ["Control API"], summary: "Change the scene, put a graphic up or down, or play a sound — now", body: controlDoBodySchema },
      config: PRESS_LIMIT,
    },
    async (request) => {
      const actions = request.body.actions as RuleAction[];
      const sound = actions.some((a) => a.do === "sound");
      const scene = actions.some((a) => a.do !== "sound");
      const { owner } = await authenticateControl(request, scene ? "scene" : "sound");
      if (sound && scene) await authenticateControl(request, "sound");
      const stream = await liveStreamOf(owner._id);
      await runActions(stream, actions, SAMPLE_WORDS);
      return { success: true, data: { done: actions.length } };
    },
  );

  app.post(
    "/control/show",
    { schema: { tags: ["Control API"], summary: "Run the show: start it, go to the next segment, or stop", body: controlShowBodySchema }, config: PRESS_LIMIT },
    async (request) => {
      const { owner } = await authenticateControl(request, "show");
      const stream = await liveStreamOf(owner._id);
      const segments = await segmentsOf(owner._id);
      if (segments.length === 0) throw new ApiError(409, "There's no run of show — write one in the studio first", "NO_RUNDOWN");
      const onAirIndex = stream.rundown?.segmentId ? segments.findIndex((s) => s.id === stream.rundown?.segmentId) : -1;
      const { step } = request.body;
      const target = step === "stop" ? null : step === "start" || onAirIndex < 0 ? segments[0]! : (segments[onAirIndex + 1] ?? null);
      if (step === "next" && onAirIndex >= 0 && !target) throw new ApiError(409, "That was the last segment", "LAST_SEGMENT");
      const position = await moveShow(stream, owner, target?.id ?? null);
      // The segment's cues, as the studio's Next applies them.
      const { actions, skipped } = target ? cueActions(target) : { actions: [], skipped: [] };
      if (actions.length > 0) await runActions(stream, actions, {});
      // A sponsor cue goes up the way the studio puts one up — through the
      // scene, from the host's own records — so a campaign's time counts.
      const sponsorCue = target?.cues?.find((c) => c.do === "sponsor" || c.do === "hide-sponsor");
      const left = skipped.filter((k) => k !== "sponsor" && k !== "hide-sponsor");
      if (sponsorCue) {
        try {
          const fresh = await Stream.findById(stream._id).select("scene").lean();
          const cur = sceneView(fresh?.scene);
          const layers: SceneLayer[] = (cur.layers as SceneLayer[]).filter((l) => l.kind !== "sponsor");
          if (sponsorCue.do === "sponsor") {
            layers.push({
              kind: "sponsor",
              source: sponsorCue.source as "own" | "campaign",
              sponsorId: String(sponsorCue.sponsorId),
              name: "",
              line: "",
              url: "",
              code: "",
              logoUrl: null,
              restricted: false,
            });
          }
          // The stored scene is already the wire shape; only the layers change here.
          await putScene(stream._id, { ...(cur as unknown as SceneBody), layers });
        } catch (err) {
          // A sponsor since removed, or a scene that kept moving: the rest of the segment still went up.
          request.log.warn({ err }, "control: sponsor cue didn't go up");
          left.push(sponsorCue.do);
        }
      }
      const next = target ? (segments[segments.indexOf(target) + 1]?.title ?? null) : null;
      return { success: true, data: { position, onAir: target?.title ?? null, next, skipped: left } };
    },
  );

  app.post(
    "/control/rules/:ruleId/fire",
    { schema: { tags: ["Control API"], summary: "Do what a show rule does, now", params: ruleIdParamsSchema }, config: PRESS_LIMIT },
    async (request) => {
      const { owner } = await authenticateControl(request, "rules");
      const rule = await ShowRule.findOne({ _id: request.params.ruleId, ownerId: owner._id }).lean();
      if (!rule) throw new ApiError(404, "That rule isn't there any more", "RULE_NOT_FOUND");
      const stream = await liveStreamOf(owner._id);
      await runActions(stream, rule.then as RuleAction[], SAMPLE_WORDS);
      return { success: true, data: { fired: String(rule._id) } };
    },
  );
};
