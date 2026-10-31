import fs from "node:fs/promises";
import path from "node:path";
import { pool, closedb } from "../src/config/db";
import { withTransaction } from "../src/db/transaction";

const MIGRATIONS_DIR = path.join(__dirname, "..", "src", "db", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations",
  );
  return new Set(rows.map((row) => row.name));
}

async function main() {
  await ensureMigrationsTable();

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort(); // 001_, 002_, ... run in order

  const applied = await getAppliedMigrations();
  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log("[migrate] nothing to apply, database is up to date");
    return;
  }

  for (const file of pending) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
    });

    console.log(`[migrate] applied ${file}`);
  }

  console.log(`[migrate] done, ${pending.length} migration(s) applied`);
}

main()
  .catch((err) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closedb());
