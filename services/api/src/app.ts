import Fastify, { type FastifyError } from "fastify";
import {
  clerkPlugin,
  type ClerkFastifyOptions,
} from "@clerk/fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rawBody from "fastify-raw-body";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { config } from "./config.js";
import { isDatabaseReady } from "./database.js";
import { ApiError } from "./errors.js";
import { apiRoutes } from "./routes/index.js";

// Known first-party web origins that call this API. These are always allowed
// so CORS doesn't silently break if CORS_ORIGINS is unset or incomplete in a
// given environment; CORS_ORIGINS adds any additional origins on top.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://xtreme.worldstreetgold.com",
  "https://worldstreetgold.com",
  "https://www.worldstreetgold.com",
];

function isAllowedOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) return true;
  if (config.corsOrigins.includes(origin)) return true;
  if (
    config.NODE_ENV !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return true;
  }
  return false;
}

function errorStatus(error: unknown) {
  if (error instanceof ApiError) return error.statusCode;
  if (!error || typeof error !== "object") return 500;
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) return 400;
  if (fastifyError.statusCode && fastifyError.statusCode >= 400) {
    return fastifyError.statusCode;
  }
  return 500;
}

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard" },
            },
          }
        : {}),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = errorStatus(error);
    const isServerError = statusCode >= 500;
    const fastifyError = error as FastifyError;

    if (isServerError) {
      request.log.error({ err: error }, "Request failed");
    } else {
      request.log.warn({ err: error, statusCode }, "Request rejected");
    }

    const apiError = error instanceof ApiError ? error : null;
    return reply.code(statusCode).send({
      success: false,
      message: isServerError
        ? "Internal server error"
        : apiError?.message || fastifyError.message || "Request failed",
      code:
        apiError?.code ||
        (fastifyError.validation ? "VALIDATION_ERROR" : "REQUEST_ERROR"),
      requestId: request.id,
      ...(fastifyError.validation
        ? { details: fastifyError.validation }
        : {}),
    });
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addContentTypeParser(
    "application/webhook+json",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  await app.register(cors, {
    credentials: true,
    // Must be explicit: the default only advertises the "simple" methods
    // (GET/HEAD/POST), so browsers preflight-block DELETE and PATCH — which
    // silently breaks unfollow, unlike, and profile/stream updates.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new ApiError(403, "Origin not allowed", "CORS_DENIED"), false);
      }
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });
  const clerkOptions: ClerkFastifyOptions & {
    authorizedParties?: string[];
  } = {
    publishableKey: config.CLERK_PUBLISHABLE_KEY,
    secretKey: config.CLERK_SECRET_KEY,
    ...(config.clerkAuthorizedParties.length > 0
      ? { authorizedParties: config.clerkAuthorizedParties }
      : {}),
  };
  await app.register(clerkPlugin, clerkOptions);
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Xtreme Worldstreet API",
        description:
          "Headless livestreaming API for the web and React Native clients.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Clerk session JWT",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
    staticCSP: true,
  });

  app.get(
    "/health/live",
    {
      config: { rateLimit: false },
      schema: { hide: true },
    },
    async () => ({
      status: "ok",
      service: "xtreme-api",
      uptime: process.uptime(),
    }),
  );

  app.get(
    "/health/ready",
    {
      config: { rateLimit: false },
      schema: { hide: true },
    },
    async (_request, reply) => {
      const ready = isDatabaseReady();
      return reply.code(ready ? 200 : 503).send({
        status: ready ? "ready" : "not_ready",
        database: ready ? "connected" : "disconnected",
      });
    },
  );

  await app.register(apiRoutes, { prefix: "/v1" });
  await app.register(apiRoutes, { prefix: "/api" });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      success: false,
      message: "Route not found",
      code: "NOT_FOUND",
      requestId: request.id,
    });
  });

  return app;
}
