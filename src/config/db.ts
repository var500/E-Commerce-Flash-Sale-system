import { Pool } from "pg";
import { env } from "./env";

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3000, // 3s
  idleTimeoutMillis: 30000, // 30s
});

pool.on("error", (err) => {
  console.error("[postgress] idle client error:", err.message);
});

export async function connectdb(): Promise<void> {
  const client = await pool.connect();
  client.release(); // always give the client back to the pool
  console.log("[postgres] connected to db");
}

export async function checkdb(): Promise<void> {
  await pool.query("SELECT 1");
}

export async function closedb(): Promise<void> {
  await pool.end();
  console.log("[postgres] connection closed");
}
