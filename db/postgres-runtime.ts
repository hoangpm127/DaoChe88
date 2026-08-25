/**
 * Adapter PostgreSQL cho interface `RuntimeDatabase`.
 *
 * Mục tiêu: code nghiệp vụ (khoảng 3.000 dòng SQL trong lib/) KHÔNG phải viết lại.
 * Adapter chịu trách nhiệm bắc cầu hai khác biệt lớn giữa SQLite và PostgreSQL:
 *
 *   1. Placeholder: SQLite dùng `?`, PostgreSQL dùng `$1, $2…`
 *   2. Số dòng bị ảnh hưởng: SQLite trả `changes`, PostgreSQL trả `rowCount`
 *
 * ĐIỂM SỐNG CÒN — ĐỌC TRƯỚC KHI SỬA FILE NÀY
 * Toàn hệ thống chống ghi đè đồng thời bằng khóa lạc quan:
 *     UPDATE … WHERE id = ? AND updated_at = ?
 *     rồi kiểm results[0].meta.changes !== 1 để phát hiện xung đột.
 * Nếu `meta.changes` trả sai, cơ chế đó hỏng **âm thầm** — hai người sửa cùng một
 * đơn sẽ ghi đè nhau mà không có lỗi nào báo ra. Tương tự, `batch()` PHẢI là một
 * transaction duy nhất: nửa chừng thất bại phải rollback sạch.
 */

import type {
  RuntimeDatabase,
  RuntimeDatabaseMeta,
  RuntimeDatabaseResult,
  RuntimeDatabaseValue,
  RuntimePreparedStatement,
} from "./runtime-database.ts";

/** Kết quả thô mà mọi backend Postgres phải trả về. */
type BackendResult = { rows: Record<string, unknown>[]; affected: number };

/** Lớp mỏng để dùng chung cho postgres.js (production) và pglite (test cục bộ). */
interface PostgresBackend {
  query(sql: string, params: unknown[]): Promise<BackendResult>;
  transaction<T>(run: (tx: PostgresBackend) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Đổi placeholder `?` sang `$1, $2…`.
 *
 * Phải bỏ qua `?` nằm trong chuỗi, trong định danh trích dẫn và trong chú thích —
 * nếu không sẽ phá vỡ câu lệnh. Ví dụ `note = 'Sao ạ?'` không được đụng tới.
 */
export function toPostgresPlaceholders(sql: string): string {
  let out = "";
  let position = 0;
  let index = 0;

  while (position < sql.length) {
    const character = sql[position];

    // Chuỗi ký tự: '…' với '' là dấu nháy được thoát.
    if (character === "'") {
      out += character;
      position += 1;
      while (position < sql.length) {
        if (sql[position] === "'" && sql[position + 1] === "'") {
          out += "''";
          position += 2;
          continue;
        }
        out += sql[position];
        if (sql[position] === "'") {
          position += 1;
          break;
        }
        position += 1;
      }
      continue;
    }

    // Định danh trích dẫn: "…"
    if (character === '"') {
      out += character;
      position += 1;
      while (position < sql.length) {
        out += sql[position];
        if (sql[position] === '"') {
          position += 1;
          break;
        }
        position += 1;
      }
      continue;
    }

    // Chú thích một dòng: -- …
    if (character === "-" && sql[position + 1] === "-") {
      const lineEnd = sql.indexOf("\n", position);
      const stop = lineEnd === -1 ? sql.length : lineEnd;
      out += sql.slice(position, stop);
      position = stop;
      continue;
    }

    // Chú thích khối: /* … */
    if (character === "/" && sql[position + 1] === "*") {
      const blockEnd = sql.indexOf("*/", position + 2);
      const stop = blockEnd === -1 ? sql.length : blockEnd + 2;
      out += sql.slice(position, stop);
      position = stop;
      continue;
    }

    if (character === "?") {
      index += 1;
      out += `$${index}`;
      position += 1;
      continue;
    }

    out += character;
    position += 1;
  }

  return out;
}

/**
 * Chuẩn hóa tham số trước khi gửi xuống Postgres.
 *
 * Cột cờ (`is_test`, `track_stock`, `marketing_opt_in`…) được giữ kiểu INTEGER
 * trong migration Postgres, đúng như SQLite. Lý do: các ràng buộc CHECK hiện có
 * so sánh trực tiếp với số — ví dụ `is_test = CASE WHEN … THEN 1 ELSE 0 END` và
 * `marketing_opt_in IN (0, 1)`. Đổi sang `boolean` thật sẽ phải sửa hàng loạt
 * ràng buộc và câu truy vấn, rủi ro cao mà không được lợi gì. Vì vậy boolean do
 * code nghiệp vụ truyền vào được quy về 0/1 ngay tại đây.
 */
function toPostgresParams(values: RuntimeDatabaseValue[]): unknown[] {
  return values.map((value) => {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (typeof value === "bigint") {
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    }
    return value;
  });
}

/**
 * Dịch các khác biệt phương ngữ SQLite → PostgreSQL ở tầng câu lệnh.
 *
 * Làm tập trung ở đây thay vì sửa ~3.000 dòng SQL nghiệp vụ: ít rủi ro hơn nhiều
 * và có thể kiểm chứng bằng test. Chỉ xử lý những dạng thực sự xuất hiện trong
 * mã nguồn (đã đếm: 55 chỗ `INSERT OR IGNORE`, 9 chỗ `MAX(0, …)`).
 */
export function toPostgresDialect(sql: string): string {
  let out = sql;

  // `MAX(0, x)` của SQLite là hàm vô hướng hai tham số; Postgres dùng GREATEST.
  // Chỉ đổi đúng dạng hai tham số bắt đầu bằng 0 — không đụng hàm gộp MAX(col).
  out = out.replace(/\bMAX\(\s*0\s*,/gi, "GREATEST(0,");

  // `INSERT OR IGNORE INTO …` → `INSERT INTO … ON CONFLICT DO NOTHING`.
  // Mệnh đề ON CONFLICT phải nằm cuối câu, đúng cho cả dạng VALUES lẫn SELECT.
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out)) {
    out = out.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, "$1INSERT INTO");
    const trimmed = out.replace(/\s*;\s*$/, "");
    if (!/\bON\s+CONFLICT\b/i.test(trimmed)) {
      out = `${trimmed} ON CONFLICT DO NOTHING`;
    }
  }

  return out;
}

function metaFor(startedAt: number, affected: number, rowsRead: number): RuntimeDatabaseMeta {
  return {
    changes: affected,
    last_row_id: 0,
    duration: Math.max(0, Date.now() - startedAt),
    rows_read: rowsRead,
    rows_written: affected,
    changed_db: affected > 0,
    size_after: 0,
  };
}

class PostgresPreparedStatement implements RuntimePreparedStatement {
  readonly backend: PostgresBackend;
  readonly query: string;
  readonly values: RuntimeDatabaseValue[];

  constructor(backend: PostgresBackend, query: string, values: RuntimeDatabaseValue[] = []) {
    this.backend = backend;
    this.query = query;
    this.values = values;
  }

  bind(...values: RuntimeDatabaseValue[]) {
    return new PostgresPreparedStatement(this.backend, this.query, values);
  }

  /** Chạy trên một backend cụ thể — dùng để `batch()` gửi mọi câu vào cùng transaction. */
  async executeOn<T = Record<string, unknown>>(backend: PostgresBackend): Promise<RuntimeDatabaseResult<T>> {
    const startedAt = Date.now();
    const prepared = toPostgresPlaceholders(toPostgresDialect(this.query));
    const result = await backend.query(prepared, toPostgresParams(this.values));
    return {
      success: true,
      results: result.rows as T[],
      meta: metaFor(startedAt, result.affected, result.rows.length),
    };
  }

  async all<T = Record<string, unknown>>() {
    return this.executeOn<T>(this.backend);
  }

  async run<T = Record<string, unknown>>() {
    return this.executeOn<T>(this.backend);
  }

  async raw<T extends unknown[] = unknown[]>() {
    const result = await this.executeOn(this.backend);
    return result.results.map((row) => Object.values(row as Record<string, unknown>)) as T[];
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const result = await this.all<T>();
    const first = result.results[0];
    if (!first) return null;
    if (column) return (first as Record<string, RuntimeDatabaseValue>)[column] ?? null;
    return first;
  }
}

export class PostgresRuntimeDatabase implements RuntimeDatabase {
  readonly __runtimeKind = "postgres" as const;
  private readonly backend: PostgresBackend;

  constructor(backend: PostgresBackend) {
    this.backend = backend;
  }

  prepare(query: string) {
    return new PostgresPreparedStatement(this.backend, query);
  }

  /**
   * Chạy toàn bộ câu lệnh trong MỘT transaction, đúng ngữ nghĩa `d1.batch()` mà
   * code nghiệp vụ đang dựa vào. Một câu lỗi thì rollback tất cả.
   */
  async batch<T = Record<string, unknown>>(statements: RuntimePreparedStatement[]) {
    const prepared = statements.map((statement) => {
      if (!(statement instanceof PostgresPreparedStatement)) {
        throw new Error("Postgres batch chỉ nhận prepared statement từ cùng một runtime database.");
      }
      return statement;
    });

    return this.backend.transaction(async (tx) => {
      const results: RuntimeDatabaseResult<T>[] = [];
      for (const statement of prepared) results.push(await statement.executeOn<T>(tx));
      return results;
    });
  }

  async close() {
    await this.backend.close();
  }
}

/** Backend dùng postgres.js — đường chạy thật trên Railway. */
async function createPostgresJsBackend(connectionString: string): Promise<PostgresBackend> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    // Railway cấp chứng chỉ nội bộ; bật SSL nhưng không ép kiểm chuỗi tin cậy.
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? undefined
      : { rejectUnauthorized: false },
    onnotice: () => {},
  });

  const wrap = (client: typeof sql): PostgresBackend => ({
    async query(text, params) {
      const rows = await client.unsafe(text, params as never[]);
      return { rows: rows as unknown as Record<string, unknown>[], affected: rows.count ?? rows.length ?? 0 };
    },
    async transaction(run) {
      return client.begin((tx) => run(wrap(tx as unknown as typeof sql))) as Promise<never>;
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  });

  return wrap(sql);
}

/**
 * Backend dùng pglite — PostgreSQL biên dịch sang WASM, chạy ngay trong tiến trình.
 * Dùng cho test và phát triển cục bộ: cùng phương ngữ SQL với production, nhưng
 * không cần dịch vụ ngoài và không phải mở database ra Internet.
 */
type PgliteQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
type PgliteClient = {
  waitReady: Promise<unknown>;
  query: PgliteQuery;
  transaction: <T>(run: (tx: { query: PgliteQuery }) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

async function createPgliteBackend(dataDir: string): Promise<PostgresBackend> {
  let PGliteConstructor: new (dataDir?: string) => PgliteClient;
  try {
    const loaded = (await import(/* @vite-ignore */ "@electric-sql/pglite")) as {
      PGlite: new (dataDir?: string) => PgliteClient;
    };
    PGliteConstructor = loaded.PGlite;
  } catch (cause) {
    throw new Error(
      "pglite chỉ dùng cho test và phát triển cục bộ, không có trong bản build production. " +
        "Hãy đặt DATABASE_URL trỏ tới PostgreSQL thật (postgres://…).",
      { cause },
    );
  }
  // `memory` hoặc `memory:<tên>` đều chạy hoàn toàn trong bộ nhớ. Phần `<tên>`
  // chỉ để mỗi lần gọi có một chuỗi kết nối khác nhau — cache runtime khoá theo
  // chuỗi đó, nên hai test xin hai database sẽ nhận hai instance tách biệt.
  // Bám đĩa chậm hơn nhiều lần và PGlite không xả hết tệp khi đóng, nên test
  // dùng bộ nhớ; production luôn đi đường postgres:// thật.
  const inMemory = dataDir === "memory" || dataDir.startsWith("memory:");
  const client = inMemory ? new PGliteConstructor() : new PGliteConstructor(dataDir);
  await client.waitReady;

  const wrap = (handle: { query: PgliteQuery }): PostgresBackend => ({
    async query(text, params) {
      const result = await handle.query(text, params);
      return {
        rows: (result.rows || []) as Record<string, unknown>[],
        affected: result.affectedRows ?? 0,
      };
    },
    async transaction(run) {
      return client.transaction((tx) => run(wrap(tx)));
    },
    async close() {
      await client.close();
    },
  });

  return wrap(client);
}

/**
 * Tạo runtime database từ chuỗi kết nối.
 *   - `postgres://…` / `postgresql://…` → postgres.js (Railway)
 *   - `pglite://memory` hoặc `pglite:///đường/dẫn` → pglite (test, dev cục bộ)
 */
export async function createPostgresRuntime(connectionString: string): Promise<PostgresRuntimeDatabase> {
  if (connectionString.startsWith("pglite:")) {
    const target = connectionString.replace(/^pglite:\/\/?/, "") || "memory";
    return new PostgresRuntimeDatabase(await createPgliteBackend(target));
  }
  return new PostgresRuntimeDatabase(await createPostgresJsBackend(connectionString));
}
