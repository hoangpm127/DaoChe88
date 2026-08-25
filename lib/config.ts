/**
 * Nguồn đọc cấu hình duy nhất của hệ thống.
 *
 * Ranh giới phải giữ rõ (xem docs/KE_HOACH_PHAT_TRIEN.md mục M14):
 *   - BÍ MẬT và HẠ TẦNG (chuỗi kết nối, khóa API, secret phiên, đường dẫn volume)
 *     đọc từ biến môi trường qua file này.
 *   - THÔNG SỐ NGHIỆP VỤ (ngưỡng, tỷ lệ, thời hạn, phí) sẽ đọc từ bảng
 *     `system_settings` — KHÔNG thêm vào đây.
 *
 * Trước M0 các lib tự đọc `process.env` rải rác kèm fallback sang
 * `env` của `cloudflare:workers`. Cloudflare đã được gỡ (quyết định Q9) nên
 * `process.env` là nguồn duy nhất.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Đọc một biến môi trường dạng chuỗi đã trim. Trả chuỗi rỗng nếu chưa đặt. */
export function envValue(name: string): string {
  if (typeof process === "undefined" || !process.env) return "";
  return process.env[name]?.trim() || "";
}

/** Đọc biến môi trường dạng cờ bật/tắt. Chấp nhận 1/true/yes/on. */
export function envBoolean(name: string): boolean {
  return TRUTHY.has(envValue(name).toLocaleLowerCase("en-US"));
}

/**
 * Đọc biến môi trường dạng số nguyên, kèm chặn trên/dưới.
 * Giá trị thiếu hoặc ngoài phạm vi sẽ rơi về `fallback`.
 */
export function envInteger(
  name: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  const parsed = Number.parseInt(envValue(name), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Biến bắt buộc phải có khi chạy thật, kèm lý do để thông báo lỗi có ích. */
const REQUIRED_IN_PRODUCTION: ReadonlyArray<{ name: string; reason: string; minLength?: number }> = [
  { name: "PORTAL_SESSION_SECRET", reason: "dùng để ký cookie phiên portal", minLength: 32 },
  { name: "SEPAY_BANK_ACCOUNT", reason: "tài khoản nhận tiền VietQR" },
];

/**
 * Kiểm tra cấu hình một lần khi khởi động. Thiếu biến bắt buộc thì ném lỗi
 * tiếng Việt rõ ràng để tiến trình dừng hẳn, thay vì chạy nửa vời rồi hỏng
 * giữa lúc khách đang đặt hàng.
 *
 * Chỉ áp dụng khi NODE_ENV=production; môi trường dev/test được nới để chạy nhanh.
 */
export function assertProductionConfig(): void {
  if (envValue("NODE_ENV") !== "production") return;

  const problems: string[] = [];
  for (const { name, reason, minLength } of REQUIRED_IN_PRODUCTION) {
    const value = envValue(name);
    if (!value) {
      problems.push(`- ${name}: chưa được đặt (${reason}).`);
    } else if (minLength && value.length < minLength) {
      problems.push(`- ${name}: phải có ít nhất ${minLength} ký tự (${reason}).`);
    }
  }

  // Chỉ còn PostgreSQL: adapter SQLite đã được gỡ ở Bước 1, nên SQLITE_PATH
  // không còn là cấu hình hợp lệ để khởi động.
  if (!envValue("DATABASE_URL")) {
    problems.push("- DATABASE_URL: chưa được đặt. Production cần PostgreSQL trên Railway.");
  }

  if (problems.length) {
    throw new ConfigurationError(
      `Cấu hình production chưa hợp lệ, hệ thống từ chối khởi động:\n${problems.join("\n")}`,
    );
  }
}
