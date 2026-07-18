import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ChatMessage, GiftTransaction, Stream, User } from "../models.js";
import { reconcileStream } from "../stream-service.js";
import {
  chargeWalletWithSplit,
  getWalletUsdBalance,
  isWalletConfigured,
  refundWalletCharge,
} from "../wallet.js";

// Candidate for @xtreme/contracts once the web client adopts gifting too.
const sendGiftBodySchema = z.object({
  /** Gift value in USD cents (integer). $0.50 minimum, $500 cap per gift. */
  amountUsdMinor: z.number().int().min(50).max(50_000),
  giftName: z.string().trim().max(50).optional(),
  emoji: z.string().trim().max(20).optional(),
});

const centsToDecimal = (minor: number) => (minor / 100).toFixed(2);

export const giftRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/streams/:id/gifts",
    {
      schema: {
        tags: ["Gifts"],
        summary: "Send a wallet-funded gift to the streamer",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: sendGiftBodySchema,
      },
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      if (!isWalletConfigured()) {
        throw new ApiError(503, "Gifting is not available right now", "GIFTS_NOT_CONFIGURED");
      }

      const sender = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!(await reconcileStream(stream))) {
        throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      }

      const streamer = await User.findById(stream.streamerId);
      if (!streamer) {
        throw new ApiError(404, "Streamer not found", "USER_NOT_FOUND");
      }
      if (streamer._id.equals(sender.dbUser._id)) {
        throw new ApiError(400, "You cannot gift yourself", "SELF_GIFT");
      }

      // Idempotency: replaying the same key returns the original transaction
      // instead of double-charging (the wallet dedupes on its side too).
      const headerKey = request.headers["idempotency-key"];
      const idempotencyKey =
        (typeof headerKey === "string" && headerKey.trim()) || crypto.randomUUID();

      const existing = await GiftTransaction.findOne({ idempotencyKey });
      if (existing) {
        return { success: true, message: "Gift already processed", data: { gift: existing } };
      }

      const body = request.body;
      const grossUsdMinor = body.amountUsdMinor;
      const commissionUsdMinor = Math.floor(
        (grossUsdMinor * config.GIFT_COMMISSION_PERCENT) / 100,
      );
      const netUsdMinor = grossUsdMinor - commissionUsdMinor;
      const giftName = body.giftName ?? "";

      // One wallet-side transaction: debit sender (gross), credit streamer's
      // central wallet (net); the commission books as platform revenue there.
      const charged = await chargeWalletWithSplit({
        spenderClerkUserId: sender.authUserId,
        recipientClerkUserId: streamer.authUserId,
        amountUsdMinor: grossUsdMinor,
        recipientAmountUsdMinor: netUsdMinor,
        description: giftName
          ? `Gift (${giftName}) to @${streamer.username}`
          : `Tip to @${streamer.username}`,
        idempotencyKey: `livestream:${idempotencyKey}`,
        metadata: {
          streamId: String(stream._id),
          streamerUsername: streamer.username,
          giftName,
        },
      });

      if (!charged.ok) {
        if (charged.code === "INSUFFICIENT_BALANCE") {
          throw new ApiError(
            402,
            "Insufficient wallet balance — top up your dollar balance to send gifts",
            "INSUFFICIENT_BALANCE",
          );
        }
        if (charged.code === "UNREACHABLE" || charged.code === "NOT_CONFIGURED") {
          throw new ApiError(503, "The wallet service is unavailable", "WALLET_UNAVAILABLE");
        }
        request.log.error({ code: charged.code, msg: charged.message }, "wallet gift charge failed");
        throw new ApiError(502, charged.message, charged.code);
      }

      const chargeId = charged.data.charge?.id ?? "";

      try {
        const gift = await GiftTransaction.create({
          senderId: sender.dbUser._id,
          streamerId: streamer._id,
          streamId: stream._id,
          giftName,
          emoji: body.emoji ?? "",
          grossUsdMinor,
          commissionUsdMinor,
          netUsdMinor,
          walletChargeId: chargeId,
          idempotencyKey,
        });

        await User.updateOne(
          { _id: streamer._id },
          { $inc: { earningsUsdMinor: netUsdMinor } },
        );

        // Announce it in persisted chat so late joiners see the tip too.
        const message = await ChatMessage.create({
          streamId: stream._id,
          userId: sender.dbUser._id,
          username: sender.dbUser.username,
          avatar: sender.dbUser.avatar,
          isMod: false,
          content: giftName ? `sent a ${giftName}` : "tipped",
          type: "tip",
          tipAmount: centsToDecimal(grossUsdMinor),
          tipCurrency: "USD",
          emoji: body.emoji ?? null,
        });

        return { success: true, message: "Gift sent", data: { gift, chatMessage: message } };
      } catch (error) {
        // The money moved but our bookkeeping failed — put the money back.
        request.log.error({ err: error, chargeId }, "gift bookkeeping failed; refunding charge");
        if (chargeId) {
          await refundWalletCharge({
            clerkUserId: sender.authUserId,
            chargeId,
            reason: "livestream gift bookkeeping failed",
          }).catch(() => {
            request.log.error({ chargeId }, "gift refund also failed — manual reconciliation needed");
          });
        }
        throw new ApiError(500, "Could not record the gift — you have not been charged", "GIFT_FAILED");
      }
    },
  );

  app.get(
    "/wallet/balance",
    {
      schema: {
        tags: ["Gifts"],
        summary: "Spendable USD wallet balance for the signed-in user",
        security: [{ bearerAuth: [] }],
      },
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      if (!isWalletConfigured()) {
        throw new ApiError(
          503,
          "The wallet service is unavailable",
          "WALLET_UNAVAILABLE",
        );
      }

      const { authUserId } = await authenticate(request);
      const result = await getWalletUsdBalance(authUserId);

      if (!result.ok) {
        request.log.error(
          { code: result.code, msg: result.message },
          "wallet balance lookup failed",
        );
        throw new ApiError(
          503,
          "Could not read your wallet balance",
          "WALLET_UNAVAILABLE",
        );
      }

      const usd = result.data.balances.USD;
      return {
        success: true,
        data: {
          availableUsdMinor: usd.availableMinor,
          lockedUsdMinor: usd.lockedMinor,
          currency: "USD",
        },
      };
    },
  );

  app.get(
    "/user/me/earnings",
    {
      schema: {
        tags: ["Gifts"],
        summary: "Gift earnings summary + recent transactions for the signed-in user",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);

      const [sentAgg, receivedAgg, transactions] = await Promise.all([
        GiftTransaction.aggregate<{ _id: null; total: number; count: number }>([
          { $match: { senderId: dbUser._id } },
          { $group: { _id: null, total: { $sum: "$grossUsdMinor" }, count: { $sum: 1 } } },
        ]),
        GiftTransaction.aggregate<{ _id: null; total: number; count: number }>([
          { $match: { streamerId: dbUser._id } },
          { $group: { _id: null, total: { $sum: "$netUsdMinor" }, count: { $sum: 1 } } },
        ]),
        GiftTransaction.find({
          $or: [{ senderId: dbUser._id }, { streamerId: dbUser._id }],
        })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate("senderId", "username displayName avatar")
          .populate("streamerId", "username displayName avatar")
          .lean(),
      ]);

      return {
        success: true,
        data: {
          earnings: {
            balanceUsdMinor: dbUser.earningsUsdMinor,
            receivedUsdMinor: receivedAgg[0]?.total ?? 0,
            receivedCount: receivedAgg[0]?.count ?? 0,
            sentUsdMinor: sentAgg[0]?.total ?? 0,
            sentCount: sentAgg[0]?.count ?? 0,
            commissionPercent: config.GIFT_COMMISSION_PERCENT,
          },
          transactions,
        },
      };
    },
  );
};
