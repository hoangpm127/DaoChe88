import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { OperationsError } from "./operations-types.ts";

type StoredIdempotency = {
  requestHash: string;
  responseJson: string;
  statusCode: number;
  createdAt: string;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export async function requestHash(value: unknown) {
  const source = JSON.stringify(stableValue(value));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stored(database: RuntimeDatabase, scope: string, key: string) {
  const result = await database.prepare(`SELECT request_hash, response_json, status_code, created_at
    FROM idempotency_keys WHERE scope = ? AND key = ? LIMIT 1`).bind(scope, key).all<Record<string, unknown>>();
  const row = result.results?.[0];
  if (!row) return null;
  return {
    requestHash: String(row.request_hash || ""),
    responseJson: String(row.response_json || "{}"),
    statusCode: Number(row.status_code || 0),
    createdAt: String(row.created_at || ""),
  } satisfies StoredIdempotency;
}

function validateKey(value: string) {
  const key = value.trim();
  if (!key) return "";
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new OperationsError("Idempotency-Key không hợp lệ.", 400, "invalid_idempotency_key");
  }
  return key;
}

function replay(row: StoredIdempotency, expectedHash: string) {
  if (row.requestHash !== expectedHash) throw new OperationsError("Idempotency-Key đã được dùng cho nội dung khác.", 409, "idempotency_key_conflict");
  if (row.statusCode <= 0) return null;
  return { body: JSON.parse(row.responseJson) as unknown, status: row.statusCode, replayed: true };
}

export async function runIdempotent<T>(input: {
  database: RuntimeDatabase;
  scope: string;
  key: string;
  requestBody: unknown;
  execute: () => Promise<{ body: T; status: number }>;
}) {
  const key = validateKey(input.key);
  if (!key) return { ...(await input.execute()), replayed: false };
  const hash = await requestHash(input.requestBody);
  const now = new Date().toISOString();
  const claim = await input.database.prepare(`INSERT INTO idempotency_keys
    (key, scope, request_hash, response_json, status_code, created_at)
    VALUES (?, ?, ?, '{}', 0, ?)
    ON CONFLICT(scope, key) DO NOTHING`).bind(key, input.scope, hash, now).run();

  if (claim.meta.changes !== 1) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const row = await stored(input.database, input.scope, key);
      if (row) {
        const cached = replay(row, hash);
        if (cached) return cached as { body: T; status: number; replayed: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new OperationsError("Yêu cầu cùng khóa đang được xử lý quá lâu. Hãy thử lại với đúng khóa này.", 409, "idempotency_request_in_progress");
  }

  try {
    const result = await input.execute();
    await input.database.prepare(`UPDATE idempotency_keys SET response_json = ?, status_code = ?
      WHERE scope = ? AND key = ? AND request_hash = ? AND status_code = 0`)
      .bind(JSON.stringify(result.body), result.status, input.scope, key, hash).run();
    return { ...result, replayed: false };
  } catch (error) {
    await input.database.prepare("DELETE FROM idempotency_keys WHERE scope = ? AND key = ? AND request_hash = ? AND status_code = 0")
      .bind(input.scope, key, hash).run();
    throw error;
  }
}

export async function cleanupIdempotencyKeys(database: RuntimeDatabase, now = Date.now()) {
  const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await database.prepare("DELETE FROM idempotency_keys WHERE created_at < ?").bind(cutoff).run();
  return { deleted: result.meta.changes, cutoff };
}
