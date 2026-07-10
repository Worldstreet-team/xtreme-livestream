import type { FastifyPluginAsync } from "fastify";
import { dashboardRoutes } from "./dashboard.js";
import { streamActionRoutes } from "./stream-actions.js";
import { streamRoutes } from "./streams.js";
import { userRoutes } from "./users.js";
import { webhookRoutes } from "./webhooks.js";

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(userRoutes);
  await fastify.register(streamRoutes);
  await fastify.register(streamActionRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(webhookRoutes);
};
