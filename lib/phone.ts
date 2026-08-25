/**
 * Chuẩn hóa số điện thoại Việt Nam.
 *
 * Tách riêng khỏi lib/data-integrity.ts để tầng xác thực dùng được mà không kéo
 * theo cả module toàn vẹn dữ liệu. Hàm thuần, không phụ thuộc gì — nhờ vậy chỉ
 * có MỘT định nghĩa duy nhất cho "hai số này là cùng một người".
 */
export function normalizeVietnamPhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (!compact) return "";
  if (/^0\d{8,10}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{8,10}$/.test(compact)) return `+${compact}`;
  return compact;
}
