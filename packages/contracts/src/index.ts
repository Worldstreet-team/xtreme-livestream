import { z } from "zod";

export const CATEGORIES = [
  "Bitcoin Trading",
  "Altcoins & DeFi",
  "NFTs & Web3",
  "Market Analysis",
  "Crypto Education",
  "General / Just Chatting",
] as const;

export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid resource id");

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, "Use letters, numbers, and underscores only");

export const streamIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const usernameParamsSchema = z.object({
  username: usernameSchema,
});

export const listStreamsQuerySchema = z.object({
  live: z.enum(["true", "false"]).optional(),
  category: z.union([categorySchema, z.literal("All")]).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["viewers", "recent", "trending"]).default("viewers"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

export const topStreamersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const createStreamBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  category: categorySchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  thumbnail: z.url().max(2048).or(z.literal("")).default(""),
});

export const updateStreamBodySchema = createStreamBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export const chatQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: objectIdSchema.optional(),
});

export const createChatMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(500),
  type: z.enum(["text", "tip", "reaction"]).default("text"),
  tipAmount: z.string().trim().max(50).optional(),
  tipCurrency: z.string().trim().max(20).optional(),
  emoji: z.string().trim().max(20).optional(),
});

export const updateProfileBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    username: usernameSchema.optional(),
    avatar: z.url().max(2048).or(z.literal("")).optional(),
    bio: z.string().trim().max(200).optional(),
    settings: z
      .object({
        autoRecord: z.boolean().optional(),
        slowMode: z.boolean().optional(),
        subscriberOnly: z.boolean().optional(),
        profanityFilter: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiFailure {
  success: false;
  message: string;
  code?: string;
  requestId?: string;
  details?: unknown;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
