import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

/**
 * Env loading lives in its own module so the ENTRY POINT can import it before
 * anything else. Two past failure modes this kills:
 *
 * 1. cwd-relative loading — the workspace runner starts this service from the
 *    repo root, where no .env exists; resolve against the package instead.
 * 2. import-order capture — @clerk/fastify's ambient clerkClient snapshots
 *    process.env AT MODULE INIT. server.ts used to import app.ts (→ auth.ts
 *    → @clerk/fastify) before config.ts ever ran dotenv, so the client froze
 *    an empty secret key and every authenticated route 500'd with "Missing
 *    Clerk Secret Key". `import "./env.js"` FIRST makes the order a fact.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadEnv({ path: path.join(packageRoot, ".env") });
