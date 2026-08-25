/**
 * Cú pháp riêng của SQLite không được lọt vào truy vấn chạy trên PostgreSQL.
 *
 * ==========================================================================
 * VÌ SAO CÓ TỆP NÀY
 * ==========================================================================
 * Nhánh codex-hoangdz tìm ra `ORDER BY created_at, rowid` trong
 * lib/commands-orders.ts và lib/data-integrity.ts. `rowid` là cột giả riêng của
 * SQLite; PostgreSQL không có. Kiểm trực tiếp trên DB production ngày
 * 2026-08-23 xác nhận: `column "rowid" does not exist`.
 *
 * Ba lớp phòng thủ khi đó đều KHÔNG bắt được nó:
 *   - Lớp dịch phương ngữ (db/postgres-runtime.ts) chỉ xử lý những dạng tác giả
 *     ĐẾM TAY được lúc viết: `INSERT OR IGNORE` và `MAX(0, …)`. Đếm tay thì sót.
 *   - Chốt schemaIsManagedByMigrations chỉ bảo vệ hàm tạo schema, không bảo vệ
 *     truy vấn nghiệp vụ.
 *   - Phần lớn test chạy trên SQLite, nơi `rowid` hợp lệ nên test vẫn xanh.
 *     (Chính ghi chú nghiệm thu GĐ1, LƯU Ý 3, đã cảnh báo điều này.)
 *
 * Lỗi nằm im ở đúng đoạn lẽ ra phải báo "bạn đã đặt đơn này rồi" — đường hiếm
 * chạy, nên không ai gặp cho tới khi có khách bấm đặt hai lần.
 *
 * ==========================================================================
 * CẬP NHẬT SAU BƯỚC 1
 * ==========================================================================
 * Adapter SQLite đã được gỡ hẳn và toàn bộ test nay chạy trên PostgreSQL thật
 * (PGlite) với schema lấy từ chính `drizzle/`. Vì vậy lưới này siết chặt hơn
 * trước: cấm PRAGMA ở mọi nơi (không còn hoàn cảnh hợp lệ), cấm mọi đường quay
 * lại SQLite, và cấm định nghĩa schema ngoài `drizzle/`.
 *
 * Quét tĩnh vẫn giữ nguyên giá trị: rẻ, chạy nhanh, và chặn ngay ở lần viết
 * thay vì đợi tới lúc có request thật trên production.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

/** Bỏ chú thích để không bắt nhầm phần giải thích như chính đoạn văn trên. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

async function collectFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    const root = new URL(dir, repoRoot);
    const walk = async (directory, prefix) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
        const path = `${prefix}${entry.name}`;
        if (entry.isDirectory()) await walk(child, `${path}/`);
        else if (/\.ts$/.test(entry.name)) files.push({ path, text: stripComments(await readFile(child, "utf8")) });
      }
    };
    await walk(root, dir);
  }
  return files;
}

/** db/postgres-runtime.ts CHÍNH LÀ lớp dịch — nó buộc phải nhắc tên các cú pháp đó. */
const LOP_DICH = "db/postgres-runtime.ts";

/**
 * Cú pháp SQLite mà PostgreSQL KHÔNG hiểu, và lớp dịch phương ngữ KHÔNG xử lý.
 * Mỗi mục ghi kèm cách viết đúng để người sửa không phải tra cứu.
 */
const SQLITE_ONLY = [
  { pattern: /\browid\b/i, ten: "rowid", thay_bang: "cột id (PostgreSQL không có rowid)" },
  { pattern: /\bINSERT\s+OR\s+REPLACE\b/i, ten: "INSERT OR REPLACE", thay_bang: "INSERT … ON CONFLICT (…) DO UPDATE" },
  { pattern: /\bAUTOINCREMENT\b/i, ten: "AUTOINCREMENT", thay_bang: "GENERATED ALWAYS AS IDENTITY" },
  { pattern: /\bsqlite_master\b/i, ten: "sqlite_master", thay_bang: "information_schema hoặc pg_catalog" },
  { pattern: /\bIFNULL\s*\(/i, ten: "IFNULL(", thay_bang: "COALESCE(" },
  { pattern: /\bGROUP_CONCAT\s*\(/i, ten: "GROUP_CONCAT(", thay_bang: "string_agg(" },
  { pattern: /\bstrftime\s*\(/i, ten: "strftime(", thay_bang: "to_char(… , '…')" },
  { pattern: /\bjulianday\s*\(/i, ten: "julianday(", thay_bang: "phép trừ trên kiểu timestamp" },
  { pattern: /\bLIMIT\s+-1\b/i, ten: "LIMIT -1", thay_bang: "bỏ hẳn mệnh đề LIMIT" },
  { pattern: /\bPRAGMA\b/i, ten: "PRAGMA", thay_bang: "information_schema (adapter SQLite đã bị gỡ)" },
];

function quetDong(files, pattern, dinhDang) {
  const viPham = [];
  for (const { path, text } of files) {
    if (path === LOP_DICH) continue;
    text.split("\n").forEach((line, index) => {
      if (pattern.test(line)) viPham.push(dinhDang(path, index + 1, line));
    });
  }
  return viPham;
}

test("truy vấn nghiệp vụ không dùng cú pháp riêng của SQLite", async () => {
  const files = await collectFiles(["lib/", "app/", "db/", "scripts/"]);
  const viPham = [];

  for (const { pattern, ten, thay_bang } of SQLITE_ONLY) {
    viPham.push(...quetDong(files, pattern, (path, dong) => `${path}:${dong}  ${ten}  →  dùng ${thay_bang}`));
  }

  assert.deepEqual(
    viPham,
    [],
    `Cú pháp riêng của SQLite sẽ ném lỗi khi chạy trên PostgreSQL production:\n  ${viPham.join("\n  ")}`,
  );
});

test("không còn đường nào quay lại SQLite", async () => {
  const files = await collectFiles(["lib/", "app/", "db/", "scripts/"]);
  const viPham = [];

  for (const { path, text } of files) {
    if (path === LOP_DICH) continue;
    if (/["']node:sqlite["']/.test(text)) viPham.push(`${path} — import node:sqlite`);
    if (/\bDatabaseSync\b/.test(text)) viPham.push(`${path} — dùng DatabaseSync của node:sqlite`);
    if (/\bSQLITE_PATH\b|\bDATABASE_PATH\b/.test(text)) viPham.push(`${path} — đọc biến môi trường của SQLite`);
  }

  assert.deepEqual(
    viPham,
    [],
    "Adapter SQLite đã được gỡ ở Bước 1. Runtime chỉ còn PostgreSQL qua DATABASE_URL\n" +
      `(postgres://… trên Railway, pglite://… khi chạy test):\n  ${viPham.join("\n  ")}`,
  );
});

test("schema chỉ được định nghĩa trong drizzle/, không nơi nào khác", async () => {
  // Đây là lý do gốc của cả Bước 1: hai bản định nghĩa schema song song thì bản
  // mà test kiểm KHÔNG phải bản mà production chạy.
  const files = (await collectFiles(["lib/", "app/", "db/"]))
    // db/migrate.ts tự tạo bảng ghi sổ migration — đó đúng là việc của nó.
    .filter(({ path }) => path !== "db/migrate.ts");

  const viPham = quetDong(files, /\bCREATE\s+(TABLE|INDEX|TRIGGER)\b/i, (path, dong) => `${path}:${dong}`);

  assert.deepEqual(
    viPham,
    [],
    "Định nghĩa schema phải nằm trong drizzle/. DDL trong đường chạy request là\n" +
      `bản định nghĩa THỨ HAI — nó sẽ lệch dần và đánh lừa người đọc:\n  ${viPham.join("\n  ")}`,
  );
});
