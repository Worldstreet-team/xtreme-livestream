import type { FastifyPluginAsync } from "fastify";
import { dashboardRoutes } from "./dashboard.js";
import { giftRoutes } from "./gifts.js";
import { coLiveRoutes } from "./colive.js";
import { guestRoutes } from "./guests.js";
import { moderationRoutes } from "./moderation.js";
import { notificationRoutes } from "./notifications.js";
import { streamActionRoutes } from "./stream-actions.js";
import { streamRoutes } from "./streams.js";
import { userRoutes } from "./users.js";
import { webhookRoutes } from "./webhooks.js";

export const apiRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(userRoutes);
  await fastify.register(streamRoutes);
  await fastify.register(streamActionRoutes);
  await fastify.register(dashboardRoutes);
  await fastify.register(giftRoutes);
  await fastify.register(guestRoutes);
  await fastify.register(coLiveRoutes);
  await fastify.register(moderationRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(webhookRoutes);
};
