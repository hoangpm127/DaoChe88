/**
 * Chặn dò mật khẩu, lưu trạng thái trong database.
 *
 * lib/rate-limit.ts cũ dùng `Map` trong bộ nhớ tiến trình: chạy hai instance thì
 * giới hạn nhân đôi, và restart là mất sạch — nghĩa là kẻ dò chỉ cần đợi một lần
 * deploy. Với đường đăng nhập thì điều đó không chấp nhận được, nên trạng thái
 * phải nằm ở nơi mọi instance cùng thấy.
 */

import type { RuntimeDatabase } from "../db-types.ts";
import { queryRows } from "../operations-sql.ts";

export type RateLimitDecision = {
  blocked: boolean;
  retryAfterSeconds: number;
  attempts: number;
};

export type RateLimitOptions = {
  /** Số lần thất bại tối đa trong một cửa sổ trước khi khóa. */
  maxAttempts: number;
  /** Độ dài cửa sổ đếm, tính bằng giây. */
  windowSeconds: number;
  /** Thời gian khóa sau khi vượt ngưỡng, tính bằng giây. */
  blockSeconds: number;
};

export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  maxAttempts: 8,
  windowSeconds: 15 * 60,
  blockSeconds: 15 * 60,
};

/** Chỉ kiểm tra, không tính thêm lượt. Gọi trước khi xử lý đăng nhập. */
export async function checkRateLimit(
  database: RuntimeDatabase,
  key: string,
  options: RateLimitOptions = LOGIN_RATE_LIMIT,
  now = new Date(),
): Promise<RateLimitDecision> {
  const rows = await queryRows<{ attempts: number; windowStartedAt: string; blockedUntil: string | null }>(
    database.prepare("SELECT attempts, window_started_at, blocked_until FROM auth_rate_limits WHERE key = ? LIMIT 1").bind(key),
  );
  const row = rows[0];
  if (!row) return { blocked: false, retryAfterSeconds: 0, attempts: 0 };

  if (row.blockedUntil && new Date(row.blockedUntil) > now) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(row.blockedUntil).getTime() - now.getTime()) / 1000)),
      attempts: Number(row.attempts),
    };
  }

  const windowAge = (now.getTime() - new Date(row.windowStartedAt).getTime()) / 1000;
  return {
    blocked: false,
    retryAfterSeconds: 0,
    attempts: windowAge >= options.windowSeconds ? 0 : Number(row.attempts),
  };
}

/**
 * Ghi nhận một lần thất bại. Trả về quyết định SAU khi đã cộng lượt, nên nơi gọi
 * biết ngay lần này đã chạm ngưỡng khóa hay chưa.
 */
export async function recordFailure(
  database: RuntimeDatabase,
  key: string,
  options: RateLimitOptions = LOGIN_RATE_LIMIT,
  now = new Date(),
): Promise<RateLimitDecision> {
  const current = await checkRateLimit(database, key, options, now);
  if (current.blocked) return current;

  const attempts = current.attempts + 1;
  const blockedUntil = attempts >= options.maxAttempts
    ? new Date(now.getTime() + options.blockSeconds * 1000).toISOString()
    : null;

  // Cửa sổ đếm được đặt lại khi lượt đầu tiên của cửa sổ mới xuất hiện.
  const windowStartedAt = current.attempts === 0 ? now.toISOString() : null;

  await database
    .prepare(
      `INSERT INTO auth_rate_limits (key, attempts, window_started_at, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         attempts = ?,
         window_started_at = COALESCE(?, auth_rate_limits.window_started_at),
         blocked_until = ?`,
    )
    .bind(key, attempts, windowStartedAt ?? now.toISOString(), blockedUntil, attempts, windowStartedAt, blockedUntil)
    .run();

  return {
    blocked: Boolean(blockedUntil),
    retryAfterSeconds: blockedUntil ? options.blockSeconds : 0,
    attempts,
  };
}

/** Xóa bộ đếm sau khi đăng nhập thành công. */
export async function clearRateLimit(database: RuntimeDatabase, key: string): Promise<void> {
  await database.prepare("DELETE FROM auth_rate_limits WHERE key = ?").bind(key).run();
}

/** Dọn bản ghi đã hết hạn. Gọi từ healthcheck để bảng không phình mãi. */
export async function sweepRateLimits(database: RuntimeDatabase, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const result = await database
    .prepare("DELETE FROM auth_rate_limits WHERE (blocked_until IS NULL OR blocked_until < ?) AND window_started_at < ?")
    .bind(now.toISOString(), cutoff)
    .run();
  return result.meta.changes;
}
