import { requireRuntimeDatabase, type RuntimeDatabase } from "../db/runtime-database.ts";
import { queryRows } from "./operations-sql.ts";

export type RequestRateLimitDecision = {
  blocked: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export type RequestRateLimitOptions = {
  limit: number;
  windowMs: number;
  userId?: string;
};

/**
 * Bảng rate_limit_buckets do migration trong `drizzle/` tạo.
 *
 * Trước đây hàm này dựng bảng ngay trong đường chạy request cho SQLite. Adapter
 * SQLite đã gỡ, nên không còn gì để làm — giữ hàm rỗng để các chỗ gọi không phải
 * sửa, và để rõ rằng việc tạo bảng đã chuyển hẳn sang migration.
 */
async function ensureRateLimitStorage(_database: RuntimeDatabase) {}

export function clientAddress(request: Request) {
  const forwardedChain = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (forwardedChain?.at(-1)
    || request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || "unknown")
    .trim()
    .slice(0, 128);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeBucket(
  database: RuntimeDatabase,
  bucketKey: string,
  limit: number,
  windowMs: number,
  now: Date,
): Promise<RequestRateLimitDecision> {
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + windowMs).toISOString();
  const rows = await queryRows<{ requests: number; expiresAt: string }>(database.prepare(`INSERT INTO rate_limit_buckets
      (bucket_key, requests, window_started_at, expires_at, updated_at)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT (bucket_key) DO UPDATE SET
      requests = CASE WHEN rate_limit_buckets.expires_at <= excluded.window_started_at
        THEN 1 ELSE rate_limit_buckets.requests + 1 END,
      window_started_at = CASE WHEN rate_limit_buckets.expires_at <= excluded.window_started_at
        THEN excluded.window_started_at ELSE rate_limit_buckets.window_started_at END,
      expires_at = CASE WHEN rate_limit_buckets.expires_at <= excluded.window_started_at
        THEN excluded.expires_at ELSE rate_limit_buckets.expires_at END,
      updated_at = excluded.updated_at
    RETURNING requests, expires_at`).bind(bucketKey, nowIso, expiresAt, nowIso));
  const requests = Number(rows[0]?.requests || 1);
  const bucketExpiresAt = new Date(rows[0]?.expiresAt || expiresAt).getTime();
  return {
    blocked: requests > limit,
    limit,
    remaining: Math.max(0, limit - requests),
    retryAfterSeconds: Math.max(1, Math.ceil((bucketExpiresAt - now.getTime()) / 1000)),
  };
}

/**
 * Bộ đếm nằm trong PostgreSQL nên mọi Railway instance cùng nhìn một cửa sổ.
 * Khóa chỉ chứa SHA-256 của IP/user id; không lưu địa chỉ mạng hay định danh thô.
 */
export async function consumeRequestRateLimit(
  request: Request,
  scope: string,
  options: RequestRateLimitOptions,
  now = new Date(),
) {
  const database = await requireRuntimeDatabase();
  await ensureRateLimitStorage(database);
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1_000, Math.floor(options.windowMs));
  const normalizedScope = scope.trim().slice(0, 80) || "request";
  const keys = [`ip:${clientAddress(request)}`];
  if (options.userId?.trim()) keys.push(`user:${options.userId.trim().slice(0, 160)}`);
  const decisions = await Promise.all(keys.map(async (identity) => consumeBucket(
    database,
    `${normalizedScope}:${await sha256(identity)}`,
    limit,
    windowMs,
    now,
  )));
  return decisions.reduce((strictest, decision) => {
    if (decision.blocked && !strictest.blocked) return decision;
    return decision.remaining < strictest.remaining ? decision : strictest;
  });
}

export async function sweepRequestRateLimits(database: RuntimeDatabase, now = new Date()) {
  const result = await database.prepare("DELETE FROM rate_limit_buckets WHERE expires_at < ?").bind(now.toISOString()).run();
  return result.meta.changes;
}
