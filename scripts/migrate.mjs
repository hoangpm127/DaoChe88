#!/usr/bin/env node
/**
 * Chạy migration lên database đang cấu hình bởi DATABASE_URL.
 *
 * Dùng cho:
 *   - phát triển cục bộ: `npm run db:migrate`
 *   - deploy: gọi trước khi server nhận request (xem scripts/start-production.mjs)
 *
 * Đọc .env nếu có, để chạy tay trên máy dev không phải tự export biến.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const raw = await readFile(resolve(projectRoot, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, value] = match;
      if (!(key in process.env)) process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  } catch {
    // Không có .env cũng được — trên Railway biến đến từ môi trường.
  }
}

async function main() {
  await loadDotEnv();

  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    console.error("Thiếu DATABASE_URL. Migration cần chuỗi kết nối PostgreSQL.");
    process.exit(1);
  }

  const { createPostgresRuntime } = await import("../db/postgres-runtime.ts");
  const { loadMigrations, runMigrations } = await import("../db/migrate.ts");

  const safeTarget = databaseUrl.replace(/\/\/[^@]*@/, "//***@");
  console.log(`Đang chạy migration lên ${safeTarget}`);

  const database = await createPostgresRuntime(databaseUrl);
  try {
    const migrations = await loadMigrations(resolve(projectRoot, "drizzle"));
    const { applied, skipped } = await runMigrations(database, migrations, (message) => console.log(message));

    if (applied.length) console.log(`Đã áp ${applied.length} migration: ${applied.join(", ")}`);
    else console.log("Không có migration mới — schema đã ở phiên bản mới nhất.");
    if (skipped.length) console.log(`Bỏ qua ${skipped.length} migration đã chạy trước đó.`);
  } finally {
    if (typeof database.close === "function") await database.close();
  }
}

main().catch((error) => {
  console.error("Migration thất bại:", error?.message || error);
  process.exitCode = 1;
});
