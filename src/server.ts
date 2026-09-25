import express from "express";
import { env } from "./config/env";
import { connectdb, closedb } from "./config/db";
import { connectRedis, closeRedis } from "./config/redis";
import { connectRabbit, closeRabbit } from "./config/rabbitmq";
import { healthRouter } from "./api/health.routes";

const app = express();
app.use(express.json());
app.use(healthRouter);

async function start() {
  try {
    await Promise.all([connectdb(), connectRedis(), connectRabbit()]);
  } catch (err) {
    console.error("Failed to connect to dependencies: ", err);
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`API running on http://localhost:${env.port}`);
  });

  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;

    shuttingDown = true;
    console.log(`\n${signal} received, shutting down...`);

    server.close(async () => {
      await Promise.allSettled([closeRabbit(), closeRedis(), closedb()]);
      console.log("Shutdown complete");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("Force shutdown after 10s");
      process.exit(1);
    }, 10000);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
