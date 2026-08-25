/**
 * Đọc và kiểm tra dữ liệu đầu vào của lệnh vận hành.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Tầng thấp nhất trong nhóm xử
 * lý lệnh: hàm thuần, chỉ phụ thuộc kiểu dữ liệu, nên mọi module lệnh đều import
 * được mà không tạo vòng phụ thuộc.
 */

import { OperationsError, type CommandPayload, type JsonRecord } from "./operations-types.ts";

export function readData(payload: CommandPayload) {
  const nested = payload.data && typeof payload.data === "object" ? payload.data : {};
  return { ...payload, ...nested } as JsonRecord;
}

export function readString(data: JsonRecord, key: string, required = true) {
  const value = typeof data[key] === "string" ? data[key].trim() : "";
  if (required && !value) throw new OperationsError(`Thiếu trường ${key}.`, 400, "missing_field");
  return value;
}

export function readInteger(data: JsonRecord, key: string, options: { min?: number; max?: number; required?: boolean } = {}) {
  const { min = 0, max = 10_000_000_000, required = true } = options;
  const value = Number(data[key]);
  if ((!Number.isFinite(value) || !Number.isInteger(value)) && required) throw new OperationsError(`Trường ${key} phải là số nguyên.`, 400, "invalid_number");
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 0;
  if (value < min || value > max) throw new OperationsError(`Trường ${key} nằm ngoài phạm vi cho phép.`, 400, "number_out_of_range");
  return value;
}


export function boundedText(data: JsonRecord, key: string, maxLength: number, required = true) {
  const value = readString(data, key, required);
  if (value.length > maxLength) throw new OperationsError(`Trường ${key} tối đa ${maxLength} ký tự.`, 400, "field_too_long");
  return value;
}


export function readIsoDate(data: JsonRecord, key: string, fallback?: string) {
  const value = readString(data, key, false) || fallback || "";
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(new Date(value).getTime())) throw new OperationsError(`Trường ${key} không phải ngày hợp lệ.`, 400, "invalid_date");
  return value;
}

