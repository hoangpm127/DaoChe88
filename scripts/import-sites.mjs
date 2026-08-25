#!/usr/bin/env node
/**
 * Nạp/cập nhật danh sách điểm bán thật theo `code`.
 *
 * Cách dùng:
 *   npm run sites:import -- duong/dan/danh-sach-cua-hang.csv --dry-run
 *   npm run sites:import -- duong/dan/danh-sach-cua-hang.csv
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { parseSeedCsv, slugify } from "./lib/seed-csv.mjs";

const requiredColumns = [
  "code", "name", "kind", "address", "district", "lat", "lng", "manager_name",
  "phone", "capacity_per_hour", "opening_hours", "owner_phone", "partner_code",
];
const allowedKinds = new Set(["official-store", "official-express", "partner-counter", "central-kitchen"]);
const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function normalizePhone(value) {
  const compact = value.replace(/[\s().-]/g, "");
  if (!compact) return "";
  if (/^0\d{9}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9}$/.test(compact)) return `+${compact}`;
  if (/^\+84\d{9}$/.test(compact)) return compact;
  throw new Error(`Số điện thoại không hợp lệ: ${value}`);
}

function openingHours(value) {
  if (!value) return "{}";
  if (value.trim().startsWith("{")) {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  }
  const match = /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`opening_hours phải là JSON hoặc HH:mm-HH:mm: ${value}`);
  return JSON.stringify(Object.fromEntries(weekdays.map((day) => [day, [[match[1], match[2]]]])));
}

function number(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} không hợp lệ: ${value}`);
  return parsed;
}

function validate(row, options = {}) {
  if (!row.code || !/^[A-Za-z0-9._-]{2,40}$/.test(row.code)) throw new Error(`Dòng ${row.line}: code không hợp lệ.`);
  if (!row.name || !row.address || !row.district) throw new Error(`Dòng ${row.line}: thiếu name/address/district.`);
  if (!options.allowSample && (/\[?mẫu\]?/iu.test(row.name) || /^EXAMPLE-/i.test(row.code))) throw new Error(`Dòng ${row.line}: đây là dữ liệu mẫu, không được nạp vào DB.`);
  if (!allowedKinds.has(row.kind)) throw new Error(`Dòng ${row.line}: kind không hợp lệ (${row.kind}).`);
  const latitude = number(row.lat, `Dòng ${row.line}: lat`, -90, 90);
  const longitude = number(row.lng, `Dòng ${row.line}: lng`, -180, 180);
  const capacity = number(row.capacity_per_hour || "0", `Dòng ${row.line}: capacity_per_hour`, 0, 100_000);
  return {
    ...row,
    code: row.code.toLocaleUpperCase("en-US"),
    id: `site-${slugify(row.code)}`,
    phone: normalizePhone(row.phone),
    ownerPhone: normalizePhone(row.owner_phone),
    latitudeE6: Math.round(latitude * 1_000_000),
    longitudeE6: Math.round(longitude * 1_000_000),
    capacity: Math.round(capacity),
    openingHoursJson: openingHours(row.opening_hours),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((argument) => !argument.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (!file) throw new Error("Thiếu đường dẫn CSV. Xem docs/mau-danh-sach-cua-hang.csv.");
  const rows = parseSeedCsv(await readFile(resolve(file), "utf8"), requiredColumns).map((row) => validate(row, { allowSample: dryRun }));
  const duplicateCodes = rows.filter((row, index) => rows.findIndex((candidate) => candidate.code === row.code) !== index);
  if (duplicateCodes.length) throw new Error(`CSV trùng code: ${[...new Set(duplicateCodes.map((row) => row.code))].join(", ")}.`);
  console.log(`Đã kiểm tra ${rows.length} dòng hợp lệ${dryRun ? " (dry-run, chưa ghi DB)" : ""}.`);
  if (dryRun) return;

  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("Thiếu DATABASE_URL.");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (transaction) => {
      for (const row of rows) {
        const owner = row.ownerPhone
          ? await transaction`SELECT id FROM users WHERE phone_e164 = ${row.ownerPhone} AND status = 'active' LIMIT 1`
          : [];
        if (row.ownerPhone && !owner[0]) throw new Error(`Dòng ${row.line}: không tìm thấy owner_phone ${row.ownerPhone}.`);
        const partner = row.partner_code
          ? await transaction`SELECT id FROM operation_partners WHERE code = ${row.partner_code} LIMIT 1`
          : [];
        if (row.partner_code && !partner[0]) throw new Error(`Dòng ${row.line}: không tìm thấy partner_code ${row.partner_code}.`);
        const now = new Date().toISOString();
        await transaction`INSERT INTO operation_sites (
          id, code, name, kind, status, address, district, manager_name, phone,
          capacity_per_hour, active_orders, partner_id, latitude_e6, longitude_e6,
          owner_user_id, opening_hours_json, service_radius_m, fulfillment_json,
          accepts_orders, timezone, opened_at, closed_at, created_at, updated_at
        ) VALUES (
          ${row.id}, ${row.code}, ${row.name}, ${row.kind}, 'open', ${row.address}, ${row.district},
          ${row.manager_name}, ${row.phone}, ${row.capacity}, 0, ${partner[0]?.id || null},
          ${row.latitudeE6}, ${row.longitudeE6}, ${owner[0]?.id || null}, ${row.openingHoursJson},
          5000, '["delivery","pickup"]', 1, 'Asia/Ho_Chi_Minh', ${now}, null, ${now}, ${now}
        ) ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name, kind = EXCLUDED.kind, address = EXCLUDED.address,
          district = EXCLUDED.district, manager_name = EXCLUDED.manager_name, phone = EXCLUDED.phone,
          capacity_per_hour = EXCLUDED.capacity_per_hour, partner_id = EXCLUDED.partner_id,
          latitude_e6 = EXCLUDED.latitude_e6, longitude_e6 = EXCLUDED.longitude_e6,
          owner_user_id = EXCLUDED.owner_user_id, opening_hours_json = EXCLUDED.opening_hours_json,
          updated_at = EXCLUDED.updated_at`;
      }
    });
    console.log(`Đã nạp/cập nhật ${rows.length} điểm bán theo code.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`Import thất bại: ${error?.message || error}`);
  process.exitCode = 1;
});
