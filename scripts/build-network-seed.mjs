#!/usr/bin/env node
/**
 * Dựng dữ liệu mạng lưới M2 từ dữ liệu cũ đã trích ở GĐ0-C.
 *
 * Đầu vào : data/seed/cua-hang.csv   (36 điểm bán trích từ mã nguồn bản demo)
 * Đầu ra  : data/seed/mang-luoi.csv  (định dạng scripts/import-sites.mjs)
 *           data/seed/doi-tac.csv    (bản ghi đối tác cho các điểm do đối tác vận hành)
 *
 * ===================================================================
 * GIẢI MÂU THUẪN "36 ĐIỂM TRONG CODE" ↔ "23 CỬA HÀNG CHỦ HỆ THỐNG NÓI"
 * ===================================================================
 * Câu hỏi này treo từ GĐ0-C (xem data/seed/BAO-CAO.md). Dữ liệu tự nó trả lời:
 *
 *   18 official-store  − 1 (Hub Xuân Phương là BẾP TỔNG)  = 17 cửa hàng chính thống
 *    6 distribution-partner                               =  6 đối tác phân phối
 *                                                     tổng = 23 cửa hàng  ✅
 *   12 partner-counter                                    = 12 quán affiliate
 *    1 Hub Xuân Phương                                    =  1 bếp tổng
 *
 * Khớp đúng nguyên văn mô tả nghiệp vụ: "23 cửa hàng (cửa hàng chính thống và
 * 1 số đối tác phân phối)" + "1 bếp tổng", còn affiliate là cơ chế riêng.
 *
 * Ba dấu hiệu độc lập cùng chỉ Hub Xuân Phương là bếp tổng:
 *   1. Số học ra đúng 23, không cần bỏ bớt điểm nào.
 *   2. Tên "Hub" khác hẳn 17 điểm còn lại đều mang tiền tố "Đảo Chè"/"Express".
 *   3. Bản demo đặt nhãn vai trò bếp là "Bếp tổng Xuân Phương" (lib/portal-access.ts).
 *
 * KHÔNG bịa: các quán affiliate vẫn được nạp đầy đủ làm điểm bán, vì chúng có
 * thật trong dữ liệu cũ. Đánh dấu chúng "đóng cửa" cho khớp con số 23 sẽ là bịa
 * theo hướng ngược lại.
 *
 * ===================================================================
 * THAM SỐ TỰ SINH (chủ hệ thống sửa được trong Quản trị → Mạng lưới)
 * ===================================================================
 *   capacity_per_hour — dữ liệu cũ không có; đặt theo loại điểm.
 *   district cho 3 điểm — dữ liệu cũ để trống vì địa chỉ không chứa tên quận.
 *   commission_bps    — hoa hồng đối tác, đặt mặc định theo loại đối tác.
 *
 * KHÔNG tự sinh: manager_name, phone, owner_phone. Đó là thông tin về NGƯỜI
 * thật, không phải tham số cấu hình. Bịa ra sẽ tạo tài khoản đăng nhập giả và
 * số điện thoại có thể trùng người ngoài. Chủ hệ thống điền sau khi gán nhân sự.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Mã điểm bán đóng vai trò bếp tổng. Xem lập luận ở đầu tệp. */
const CENTRAL_KITCHEN_CODE = "DC-XUANPHUONG";

/**
 * Quận/huyện cho các điểm mà địa chỉ không chứa tên quận nguyên văn.
 * Đây là tra cứu địa lý có thật, không phải bịa: cả ba đều nằm ở Nam Từ Liêm.
 */
const DISTRICT_FALLBACK = {
  "DC-KEANGNAM": "Nam Từ Liêm",   // Keangnam Landmark 72, Phạm Hùng
  "DC-GARDENIA": "Nam Từ Liêm",   // Vinhomes Gardenia, Hàm Nghi, Mỹ Đình
  "DC-SMARTCITY": "Nam Từ Liêm",  // Vinhomes Smart City, Tây Mỗ
};

/** Công suất mặc định theo loại điểm, phần/giờ. Chủ hệ thống sửa được. */
const CAPACITY_BY_KIND = {
  "central-kitchen": 600,
  "official-store": 120,
  "official-express": 80,
  "partner-counter": 60,
};

/** Hoa hồng mặc định theo loại đối tác, tính bằng basis point (800 = 8%). */
const COMMISSION_BY_PARTNER_KIND = {
  distribution: 1200,
  affiliate: 800,
};

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = source.replace(/^﻿/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim().replace(/\r$/, ""));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  row.push(field.trim().replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);
  const headers = rows[0];
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

/** Bọc ô chứa dấu phẩy/nháy/xuống dòng theo đúng quy tắc CSV. */
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  // BOM + CRLF để Excel mở không vỡ dấu tiếng Việt, và để khớp đúng quy ước của
  // scripts/extract-seed-data.mjs. Hai trình ghi CSV phải cùng một quy ước: khi
  // chúng lệch nhau, test "dựng lại từ dữ liệu cũ cho ra đúng tệp đang commit"
  // đỏ trên máy này và xanh trên máy khác với cùng một mã nguồn.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Mã đối tác suy từ mã điểm bán, để hai tệp nối được với nhau mà không cần bảng tra. */
function partnerCodeFor(siteCode) {
  return `DT-${siteCode.replace(/^DC-/, "")}`;
}

function siteKindOf(row) {
  if (row.code === CENTRAL_KITCHEN_CODE) return "central-kitchen";
  if (row.kind === "official-store") {
    // Bản demo gộp cả điểm express vào official-store; tách lại theo tên vì mô
    // hình chuẩn có riêng official-express (công suất và giờ mở khác nhau).
    return /express/i.test(row.name) ? "official-express" : "official-store";
  }
  // distribution-partner và partner-counter đều là quầy do đối tác vận hành.
  // Khác biệt thương mại nằm ở bản ghi đối tác (kind), không nằm ở loại điểm bán.
  return "partner-counter";
}

function partnerKindOf(row) {
  if (row.kind === "distribution-partner") return "distribution";
  if (row.kind === "partner-counter") return "affiliate";
  return null;
}

async function main() {
  const source = await readFile(resolve(projectRoot, "data/seed/cua-hang.csv"), "utf8");
  const rows = parseCsv(source);
  if (!rows.length) throw new Error("cua-hang.csv rỗng.");

  const sites = [];
  const partners = [];

  for (const row of rows) {
    const kind = siteKindOf(row);
    const district = row.district || DISTRICT_FALLBACK[row.code] || "";
    if (!district) throw new Error(`Thiếu quận/huyện cho ${row.code}; bổ sung vào DISTRICT_FALLBACK.`);

    const partnerKind = partnerKindOf(row);
    const partnerCode = partnerKind ? partnerCodeFor(row.code) : "";

    if (partnerKind) {
      partners.push({
        code: partnerCode,
        name: row.name,
        kind: partnerKind,
        district,
        status: "active",
        commission_bps: COMMISSION_BY_PARTNER_KIND[partnerKind],
      });
    }

    sites.push({
      code: row.code,
      name: row.code === CENTRAL_KITCHEN_CODE ? "Bếp tổng Đảo Chè · Xuân Phương" : row.name,
      kind,
      address: row.address,
      district,
      lat: row.lat,
      lng: row.lng,
      manager_name: "",
      phone: "",
      capacity_per_hour: CAPACITY_BY_KIND[kind],
      // Dữ liệu cũ dùng gạch ngang dài; trình nạp chấp nhận cả hai nhưng chuẩn
      // hoá ở đây để tệp xuất ra chỉ có một dạng.
      opening_hours: row.hours.replace(/–/g, "-"),
      owner_phone: "",
      partner_code: partnerCode,
    });
  }

  const siteHeaders = [
    "code", "name", "kind", "address", "district", "lat", "lng", "manager_name",
    "phone", "capacity_per_hour", "opening_hours", "owner_phone", "partner_code",
  ];
  const partnerHeaders = ["code", "name", "kind", "district", "status", "commission_bps"];

  await writeFile(resolve(projectRoot, "data/seed/mang-luoi.csv"), toCsv(siteHeaders, sites), "utf8");
  await writeFile(resolve(projectRoot, "data/seed/doi-tac.csv"), toCsv(partnerHeaders, partners), "utf8");

  const count = (predicate) => sites.filter(predicate).length;
  const stores = count((site) => site.kind !== "central-kitchen" && !partners.some((partner) => partner.code === site.partner_code && partner.kind === "affiliate"));

  console.log(`Đã ghi data/seed/mang-luoi.csv — ${sites.length} điểm bán:`);
  console.log(`  bếp tổng            : ${count((s) => s.kind === "central-kitchen")}`);
  console.log(`  cửa hàng chính thống: ${count((s) => s.kind === "official-store")}`);
  console.log(`  điểm express        : ${count((s) => s.kind === "official-express")}`);
  console.log(`  quầy đối tác        : ${count((s) => s.kind === "partner-counter")}`);
  console.log(`  → mạng lưới cửa hàng của chủ hệ thống: ${stores} (không tính quán affiliate)`);
  console.log(`Đã ghi data/seed/doi-tac.csv — ${partners.length} đối tác:`);
  console.log(`  phân phối : ${partners.filter((p) => p.kind === "distribution").length}`);
  console.log(`  affiliate : ${partners.filter((p) => p.kind === "affiliate").length}`);
}

main().catch((error) => {
  console.error(`Dựng dữ liệu mạng lưới thất bại: ${error?.message || error}`);
  process.exitCode = 1;
});
