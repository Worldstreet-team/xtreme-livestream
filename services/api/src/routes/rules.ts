import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MAX_RULES, ruleIdParamsSchema, showRuleBodySchema, type RuleAction } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { ShowRule, Stream } from "../models.js";
import { SAMPLE_WORDS, forgetRules, ruleView, runActions } from "../rules.js";

/**
 * Show rules (Phase 3): the creator's "when X happens, do Y" list — theirs
 * to write, turn on and off, and try on their live stream. The engine that
 * fires them is rules.ts.
 */

export const ruleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/users/me/rules",
    { schema: { tags: ["Show rules"], summary: "Your show rules", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const rules = await ShowRule.find({ ownerId: dbUser._id }).sort({ createdAt: 1 }).lean();
      return { success: true, data: { rules: rules.map(ruleView), max: MAX_RULES } };
    },
  );

  app.post(
    "/users/me/rules",
    {
      schema: { tags: ["Show rules"], summary: "Add a show rule", body: showRuleBodySchema, security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      if ((await ShowRule.countDocuments({ ownerId: dbUser._id })) >= MAX_RULES) {
        throw new ApiError(409, `That's the most rules a channel can have (${MAX_RULES}) — remove one first`, "TOO_MANY_RULES");
      }
      const rule = await ShowRule.create({ ...request.body, ownerId: dbUser._id });
      forgetRules(dbUser._id);
      return { success: true, data: { rule: ruleView(rule) } };
    },
  );

  app.put(
    "/users/me/rules/:ruleId",
    {
      schema: {
        tags: ["Show rules"],
        summary: "Change a show rule",
        params: ruleIdParamsSchema,
        body: showRuleBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { name, on, when, then, cooldownSec } = request.body;
      const rule = await ShowRule.findOneAndUpdate(
        { _id: request.params.ruleId, ownerId: dbUser._id },
        { $set: { name, on, when, then, cooldownSec } },
        { new: true },
      ).lean();
      if (!rule) throw new ApiError(404, "That rule isn't there any more", "RULE_NOT_FOUND");
      forgetRules(dbUser._id);
      return { success: true, data: { rule: ruleView(rule) } };
    },
  );

  app.delete(
    "/users/me/rules/:ruleId",
    { schema: { tags: ["Show rules"], summary: "Remove a show rule", params: ruleIdParamsSchema, security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await ShowRule.deleteOne({ _id: request.params.ruleId, ownerId: dbUser._id });
      forgetRules(dbUser._id);
      return { success: true, data: { removed: true } };
    },
  );

  app.post(
    "/users/me/rules/:ruleId/try",
    {
      schema: {
        tags: ["Show rules"],
        summary: "Do what a rule does, now, on your live stream — without waiting for what sets it off",
        params: ruleIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const rule = await ShowRule.findOne({ _id: request.params.ruleId, ownerId: dbUser._id }).lean();
      if (!rule) throw new ApiError(404, "That rule isn't there any more", "RULE_NOT_FOUND");
      const stream = await Stream.findOne({ streamerId: dbUser._id, isLive: true }).select("_id streamerId livekitRoomName").lean();
      if (!stream) throw new ApiError(409, "Go live to try a rule — it changes what viewers see", "NOT_LIVE");
      await runActions(stream, rule.then as RuleAction[], SAMPLE_WORDS);
      return { success: true, data: { tried: true } };
    },
  );
};
