// Env MUST load before @clerk/fastify evaluates — see env.ts.
import "./env.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { connectDatabase, disconnectDatabase } from "./database.js";
import { startSocialsRelaySweep } from "./socials-relay.js";
import { startVelocitySweep } from "./velocity.js";
import { startBattleSweep } from "./battles.js";
import { startDropSweep, startGameSweep } from "./games.js";
import { startWatchDrip } from "./points.js";
import { startPayoutSweep } from "./rewards.js";

const app = await buildApp();
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    app.log.error("Graceful shutdown timed out");
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  try {
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await connectDatabase();
  await app.listen({ host: config.HOST, port: config.PORT });
  startSocialsRelaySweep();
  startVelocitySweep();
  startBattleSweep();
  startGameSweep();
  startDropSweep();
  startPayoutSweep();
  startWatchDrip();
} catch (error) {
  app.log.fatal({ err: error }, "API failed to start");
  await disconnectDatabase();
  process.exit(1);
}
