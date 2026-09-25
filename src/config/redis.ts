import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  connectTimeout: 3000,
  maxRetriesPerRequest: 0,
});

redis.on("ready", () => {
  console.log("[redis] connected");
});
redis.on("error", (err) => {
  console.error("[redis] error:", err.message);
});
redis.on("end", () => {
  console.log("[redis] connection closed");
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}
export async function checkRedis(): Promise<void> {
  const reply = await redis.ping();
  if (!reply) {
    throw new Error(`Unexpected PING reply: ${reply}`);
  }
}
export async function closeRedis(): Promise<void> {
  await redis.quit();
}
