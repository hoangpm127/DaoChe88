import { envValue } from "../lib/config.ts";

export type RuntimeDatabaseValue = string | number | bigint | boolean | null | ArrayBuffer | Uint8Array;

export type RuntimeDatabaseMeta = {
  changes: number;
  last_row_id: number;
  duration: number;
  rows_read: number;
  rows_written: number;
  changed_db: boolean;
  size_after: number;
};

export type RuntimeDatabaseResult<T = Record<string, unknown>> = {
  success: boolean;
  results: T[];
  meta: RuntimeDatabaseMeta;
};

export interface RuntimePreparedStatement {
  bind(...values: RuntimeDatabaseValue[]): RuntimePreparedStatement;
  all<T = Record<string, unknown>>(): Promise<RuntimeDatabaseResult<T>>;
  run<T = Record<string, unknown>>(): Promise<RuntimeDatabaseResult<T>>;
  raw<T extends unknown[] = unknown[]>(): Promise<T[]>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | RuntimeDatabaseValue | null>;
}

export interface RuntimeDatabase {
  prepare(query: string): RuntimePreparedStatement;
  batch<T = Record<string, unknown>>(statements: RuntimePreparedStatement[]): Promise<RuntimeDatabaseResult<T>[]>;
  readonly __runtimeKind?: "postgres";
}

function emptyMeta(startedAt: number, changes = 0, lastRowId = 0): RuntimeDatabaseMeta {
  return {
    changes,
    last_row_id: lastRowId,
    duration: Math.max(0, Date.now() - startedAt),
    rows_read: 0,
    rows_written: changes,
    changed_db: changes > 0,
    size_after: 0,
  };
}

function asSafeNumber(value: number | bigint | undefined) {
  if (typeof value === "bigint") return Number(value <= BigInt(Number.MAX_SAFE_INTEGER) ? value : BigInt(Number.MAX_SAFE_INTEGER));
  return Number(value || 0);
}

type RuntimeDatabaseGlobal = typeof globalThis & {
  __tp88PostgresRuntime?: {
    url: string;
    promise: Promise<RuntimeDatabase>;
  };
};

const runtimeGlobal = globalThis as RuntimeDatabaseGlobal;

/**
 * Mở kết nối database dùng chung cho toàn tiến trình.
 *
 * CHỈ CÒN POSTGRESQL. Adapter SQLite đã được gỡ: nó là phương ngữ thứ hai, kéo
 * theo một bản định nghĩa schema thứ hai, và test chạy trên nó KHÔNG chứng minh
 * được production chạy được — lỗi `rowid` là bằng chứng.
 *
 * `postgres://…` cho Railway, `pglite://…` cho test và phát triển cục bộ. Cả hai
 * cùng một phương ngữ SQL, nên thứ test kiểm đúng là thứ production chạy.
 */
export async function getRuntimeDatabase(): Promise<RuntimeDatabase | null> {
  const databaseUrl = envValue("DATABASE_URL");
  if (databaseUrl) {
    if (!runtimeGlobal.__tp88PostgresRuntime || runtimeGlobal.__tp88PostgresRuntime.url !== databaseUrl) {
      runtimeGlobal.__tp88PostgresRuntime = {
        url: databaseUrl,
        promise: import("./postgres-runtime.ts").then((module) => module.createPostgresRuntime(databaseUrl)),
      };
    }
    return runtimeGlobal.__tp88PostgresRuntime.promise;
  }

  return null;
}

export async function requireRuntimeDatabase() {
  const database = await getRuntimeDatabase();
  if (!database) {
    throw new Error("Chưa cấu hình database. Cần đặt DATABASE_URL trỏ tới PostgreSQL (postgres://… trên Railway, pglite://… khi chạy test).");
  }
  return database;
}

export function getRuntimeDatabaseKind(_database: RuntimeDatabase): "postgres" {
  return "postgres";
}

/** Trả runtime về trạng thái trắng giữa hai bài test. */
export async function resetRuntimeDatabaseForTests() {
  const postgres = runtimeGlobal.__tp88PostgresRuntime;
  runtimeGlobal.__tp88PostgresRuntime = undefined;
  if (postgres) {
    const database = await postgres.promise;
    const closable = database as unknown as { close?: () => unknown };
    if (typeof closable.close === "function") await closable.close();
  }
}

/**
 * Schema do migration trong `drizzle/` sở hữu hoàn toàn — luôn luôn, không còn
 * ngoại lệ nào.
 *
 * Giữ lại hàm này để 15 chỗ gọi không phải sửa cùng lúc, nhưng nó nay là hằng số.
 * Các hàm `ensure*Schema` chỉ còn là vỏ rỗng; xem chú thích trong từng hàm.
 */
export function schemaIsManagedByMigrations(_database: RuntimeDatabase): boolean {
  return true;
}
