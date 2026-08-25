/**
 * Trình chạy migration.
 *
 * Nguyên tắc (M0): schema chỉ được tạo bằng migration có thứ tự, chạy MỘT LẦN khi
 * khởi động — không còn `CREATE TABLE IF NOT EXISTS` nằm trong đường chạy request.
 * Bảng `runtime_schema_migrations` là nguồn sự thật về việc gì đã chạy.
 *
 * Mỗi file chạy trong một transaction: lỗi giữa chừng thì rollback sạch, không để
 * database ở trạng thái nửa vời.
 */

import type { RuntimeDatabase } from "./runtime-database.ts";

export type MigrationFile = { version: number; name: string; sql: string };

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS runtime_schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)`;

/**
 * Tách một file .sql thành từng câu lệnh.
 *
 * Không thể tách thô theo dấu `;` vì thân hàm PL/pgSQL chứa dấu chấm phẩy bên
 * trong cặp `$$`. Bộ tách này bỏ qua nội dung trong `$$…$$`, trong chuỗi và
 * trong chú thích.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let position = 0;
  let inDollar = false;

  while (position < sql.length) {
    const rest = sql.slice(position);

    if (rest.startsWith("$$")) {
      inDollar = !inDollar;
      current += "$$";
      position += 2;
      continue;
    }

    const character = sql[position];

    if (!inDollar) {
      if (character === "'") {
        const end = sql.indexOf("'", position + 1);
        const stop = end === -1 ? sql.length : end + 1;
        current += sql.slice(position, stop);
        position = stop;
        continue;
      }
      if (character === "-" && sql[position + 1] === "-") {
        const lineEnd = sql.indexOf("\n", position);
        const stop = lineEnd === -1 ? sql.length : lineEnd;
        current += sql.slice(position, stop);
        position = stop;
        continue;
      }
      if (character === ";") {
        if (current.trim()) statements.push(current.trim());
        current = "";
        position += 1;
        continue;
      }
    }

    current += character;
    position += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements.filter((statement) => !/^\s*(--.*)?$/.test(statement));
}

/** Đọc danh sách migration từ thư mục `drizzle/`, sắp theo số thứ tự trong tên file. */
export async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const { readdir, readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  const { join } = await import(/* @vite-ignore */ "node:path");

  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith(".sql")).sort();

  const migrations: MigrationFile[] = [];
  for (const name of files) {
    const match = name.match(/^(\d+)/);
    if (!match) continue;
    migrations.push({
      version: Number.parseInt(match[1], 10),
      name,
      sql: await readFile(join(directory, name), "utf8"),
    });
  }
  return migrations.sort((left, right) => left.version - right.version);
}

export type MigrationOutcome = { applied: string[]; skipped: string[] };

/**
 * Áp các migration còn thiếu. Idempotent: chạy lại lần hai không đổi gì.
 */
export async function runMigrations(
  database: RuntimeDatabase,
  migrations: MigrationFile[],
  log: (message: string) => void = () => {},
): Promise<MigrationOutcome> {
  await database.prepare(MIGRATIONS_TABLE).run();

  const existing = await database.prepare("SELECT version FROM runtime_schema_migrations").all<{ version: number }>();
  const done = new Set((existing.results || []).map((row) => Number(row.version)));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (done.has(migration.version)) {
      skipped.push(migration.name);
      continue;
    }

    const statements = splitSqlStatements(migration.sql);
    log(`→ áp migration ${migration.name} (${statements.length} câu lệnh)`);

    await database.batch([
      ...statements.map((statement) => database.prepare(statement)),
      database
        .prepare("INSERT INTO runtime_schema_migrations (version, name) VALUES (?, ?) ON CONFLICT (version) DO NOTHING")
        .bind(migration.version, migration.name),
    ]);

    applied.push(migration.name);
  }

  return { applied, skipped };
}
