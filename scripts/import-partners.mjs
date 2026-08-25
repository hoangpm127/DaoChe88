#!/usr/bin/env node
/**
 * Nạp/cập nhật đối tác theo `code`.
 *
 * Phải chạy TRƯỚC scripts/import-sites.mjs, vì mỗi quầy do đối tác vận hành
 * tham chiếu tới đối tác qua cột partner_code; thiếu đối tác thì nạp điểm bán
 * sẽ dừng lại với lỗi rõ ràng thay vì tạo điểm bán mồ côi.
 *
 * Cách dùng:
 *   npm run partners:import -- data/seed/doi-tac.csv --dry-run
 *   npm run partners:import -- data/seed/doi-tac.csv
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { parseSeedCsv, slugify } from "./lib/seed-csv.mjs";

const requiredColumns = ["code", "name", "kind", "district", "status", "commission_bps"];
const allowedKinds = new Set(["distribution", "affiliate"]);
const allowedStatuses = new Set(["lead", "onboarding", "active", "paused", "closed"]);

function validate(row) {
  if (!row.code || !/^[A-Za-z0-9._-]{2,40}$/.test(row.code)) throw new Error(`Dòng ${row.line}: code không hợp lệ.`);
  if (!row.name) throw new Error(`Dòng ${row.line}: thiếu name.`);
  if (!allowedKinds.has(row.kind)) throw new Error(`Dòng ${row.line}: kind phải là distribution hoặc affiliate (${row.kind}).`);
  if (!allowedStatuses.has(row.status)) throw new Error(`Dòng ${row.line}: status không hợp lệ (${row.status}).`);
  const commission = Number(row.commission_bps);
  if (!Number.isInteger(commission) || commission < 0 || commission > 10_000) {
    throw new Error(`Dòng ${row.line}: commission_bps phải là số nguyên 0–10000 (${row.commission_bps}).`);
  }
  return {
    ...row,
    code: row.code.toLocaleUpperCase("en-US"),
    id: `partner-${slugify(row.code)}`,
    commissionBps: commission,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((argument) => !argument.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (!file) throw new Error("Thiếu đường dẫn CSV. Xem data/seed/doi-tac.csv.");

  const rows = parseSeedCsv(await readFile(resolve(file), "utf8"), requiredColumns).map(validate);
  const duplicates = rows.filter((row, index) => rows.findIndex((candidate) => candidate.code === row.code) !== index);
  if (duplicates.length) throw new Error(`CSV trùng code: ${[...new Set(duplicates.map((row) => row.code))].join(", ")}.`);
  console.log(`Đã kiểm tra ${rows.length} đối tác hợp lệ${dryRun ? " (dry-run, chưa ghi DB)" : ""}.`);
  if (dryRun) return;

  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("Thiếu DATABASE_URL.");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (transaction) => {
      for (const row of rows) {
        const now = new Date().toISOString();
        // owner_name và phone để trống: đó là thông tin về người thật, chủ hệ
        // thống điền khi ký hợp đồng. Cập nhật lại KHÔNG ghi đè hai cột đó để
        // lần nạp sau không xoá mất dữ liệu đã nhập tay.
        await transaction`INSERT INTO operation_partners (
          id, code, name, kind, owner_name, phone, district, status,
          onboarding_stage, location_count, commission_bps, monthly_revenue, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.code}, ${row.name}, ${row.kind}, '', '', ${row.district}, ${row.status},
          'new', 0, ${row.commissionBps}, 0, ${now}, ${now}
        ) ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, kind = EXCLUDED.kind, district = EXCLUDED.district,
          status = EXCLUDED.status, commission_bps = EXCLUDED.commission_bps,
          updated_at = EXCLUDED.updated_at`;
      }
    });
    console.log(`Đã nạp/cập nhật ${rows.length} đối tác theo code.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`Import đối tác thất bại: ${error?.message || error}`);
  process.exitCode = 1;
});
