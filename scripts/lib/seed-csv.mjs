/**
 * Đọc CSV cho các trình nạp dữ liệu khởi tạo.
 *
 * Tách ra vì import-sites.mjs và import-partners.mjs cần đúng một bộ quy tắc:
 * hai bản sao sẽ lệch nhau đúng vào lúc một tệp CSV có ô chứa dấu phẩy.
 *
 * Hỗ trợ BOM (Excel luôn ghi BOM khi lưu CSV UTF-8), ô bọc nháy kép, và nháy
 * kép lồng theo chuẩn CSV ("" bên trong ô đã bọc).
 */

/** Trả về mảng object, mỗi object kèm `line` là số dòng thật trong tệp. */
export function parseSeedCsv(source, requiredColumns = []) {
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
  if (quoted) throw new Error("CSV có ô chưa đóng dấu nháy kép.");
  row.push(field.trim().replace(/\r$/, ""));
  if (row.some(Boolean)) rows.push(row);

  if (rows.length < 2) throw new Error("CSV phải có dòng tiêu đề và ít nhất một dòng dữ liệu.");
  const headers = rows[0].map((value) => value.trim());
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`CSV thiếu cột: ${missing.join(", ")}.`);

  return rows.slice(1).map((values, rowIndex) => ({
    line: rowIndex + 2,
    ...Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""])),
  }));
}

/** Mã định danh an toàn cho URL/khóa chính, bỏ dấu tiếng Việt. */
export function slugify(value) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}
