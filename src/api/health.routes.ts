import { Router } from "express";
import { checkdb } from "../config/db";
import { checkRedis } from "../config/redis";
import { checkRabbit } from "../config/rabbitmq";

type ServiceStatus = {
  status: "up" | "down";
  latencyMs: number;
  error?: string;
};

const CHECK_TIMEOUT_MS = 2000;

const checks: Record<string, () => Promise<void>> = {
  postgres: checkdb,
  redis: checkRedis,
  rabbitmq: checkRabbit,
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runCheck(check: () => Promise<void>): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await withTimeout(check(), CHECK_TIMEOUT_MS);
    return { status: "up", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const results = await Promise.all(
    Object.entries(checks).map(
      async ([name, check]) => [name, await runCheck(check)] as const,
    ),
  );

  const services = Object.fromEntries(results);
  const healthy = results.every(([, result]) => result.status === "up");

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    uptimeSeconds: Math.round(process.uptime()),
    timeStamp: new Date().toISOString(),
    services,
  });
});
