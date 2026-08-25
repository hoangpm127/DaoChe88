/**
 * Dựng database cho test trên PostgreSQL thật (PGlite), dùng đúng schema production.
 *
 * ==========================================================================
 * VÌ SAO CÓ TỆP NÀY
 * ==========================================================================
 * Trước đây 18/28 tệp test chạy trên SQLite còn production chạy PostgreSQL. Hai
 * phương ngữ khác nhau, nên test xanh không chứng minh được production chạy được.
 * Lỗi `rowid` là bằng chứng: SQLite chấp nhận, PostgreSQL trả
 * `column "rowid" does not exist`, và test không bắt được vì nó chạy trên SQLite.
 *
 * Thêm vào đó, đường SQLite dùng một bản định nghĩa schema THỨ HAI (các hàm
 * `ensure*Schema` trong lib/ và db/ensure-schema.ts) tách rời khỏi `drizzle/`.
 * Hai bản schema song song thì sớm muộn cũng lệch nhau, và bản mà test kiểm
 * KHÔNG phải bản mà production chạy.
 *
 * Helper này bỏ cả hai vấn đề: mỗi test nhận một PostgreSQL trắng, schema dựng
 * từ chính `drizzle/` mà production dùng.
 *
 * ==========================================================================
 * VÌ SAO TEST NHÌN THẤY CÙNG DATABASE VỚI SERVER
 * ==========================================================================
 * `db/runtime-database.ts` lưu cache runtime trên `globalThis`. Test nạp server
 * đã build bằng `import()` trong CÙNG tiến trình, nên bản build và helper này
 * đọc chung một ô nhớ. Gọi `getRuntimeDatabase()` ở đây trả về đúng instance mà
 * server đang phục vụ request — không cần mở kết nối thứ hai.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const drizzleDirectory = path.join(projectRoot, "drizzle");

const { loadMigrations, runMigrations } = await import("../../db/migrate.ts");
const { getRuntimeDatabase, resetRuntimeDatabaseForTests } = await import("../../db/runtime-database.ts");

/** Đọc migration một lần cho cả tệp test, thay vì mỗi lần dựng lại. */
let migrationsPromise;
function migrations() {
  migrationsPromise ||= loadMigrations(drizzleDirectory);
  return migrationsPromise;
}

/**
 * Bọc RuntimeDatabase thành API ngắn gọn cho phần kiểm chứng trong test.
 *
 * Giữ tên `run`/`get`/`all` giống node:sqlite để việc chuyển đổi là cơ học, chỉ
 * khác ở chỗ phải `await` — PostgreSQL không có API đồng bộ.
 */
function assertions(database) {
  return {
    raw: database,
    async run(sql, ...params) {
      return database.prepare(sql).bind(...params).run();
    },
    async get(sql, ...params) {
      const result = await database.prepare(sql).bind(...params).all();
      return result.results?.[0];
    },
    async all(sql, ...params) {
      const result = await database.prepare(sql).bind(...params).all();
      return result.results || [];
    },
  };
}

/**
 * Tạo một PostgreSQL trắng đã chạy hết migration, và trỏ server vào đó.
 *
 * Trả về `{ database, cleanup }`. Gọi `cleanup()` trong `finally` để trả lại
 * biến môi trường và xoá thư mục dữ liệu.
 */
export async function freshDatabase(tag = "test", options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `tp88-${tag}-`));
  const previousUrl = process.env.DATABASE_URL;
  const previousSqlite = process.env.SQLITE_PATH;

  // CHẠY TRONG BỘ NHỚ, không bám đĩa. Hai lý do:
  //
  //   Tốc độ — bám đĩa khiến bộ test mất hơn 20 phút vì mỗi lần dựng database là
  //   áp lại 115 migration lên ổ cứng; trong bộ nhớ nhanh hơn nhiều lần.
  //
  //   Đúng đắn — PGlite KHÔNG xả hết tệp quan hệ ra đĩa khi đóng, nên sao chép
  //   một thư mục dữ liệu đã đóng có thể thiếu tệp và Postgres báo
  //   `could not open file "base/5/…"`. Đã thử cách chụp thư mục làm bản mẫu và
  //   nó hỏng đúng ở chỗ này.
  //
  // Định danh lấy theo tên thư mục tạm nên chắc chắn không trùng: cache runtime
  // khoá theo chuỗi kết nối, hai test sẽ nhận hai instance tách biệt.
  process.env.DATABASE_URL = `pglite://memory:${path.basename(directory)}`;
  // SQLITE_PATH được ưu tiên thấp hơn DATABASE_URL, nhưng xoá hẳn cho rõ ràng:
  // không còn đường nào quay lại SQLite.
  delete process.env.SQLITE_PATH;

  const database = await getRuntimeDatabase();
  if (!database) throw new Error("Không dựng được database PGlite cho test.");
  await runMigrations(database, await migrations());

  // Dữ liệu mồi gọi TƯỜNG MINH ở đây, không núp trong hàm tạo schema. Bài test
  // nào cần dữ liệu sẵn thì tự xin; bài nào muốn database trắng thì khỏi.
  if (options.seed) {
    const { seedDemoData, backfillD1Finance } = await import("../../lib/operations-schema.ts");
    await seedDemoData(database);
    await backfillD1Finance(database);
    // Nội dung món phải nạp riêng: migration chỉ chèn tên và giá. Đây đúng là
    // đường mà production cần chạy (scripts/import-catalog.mjs).
    const { seedCatalogContent } = await import("../../lib/catalog-store.ts");
    await seedCatalogContent(database);
    // Đơn trong dữ liệu mồi cần hồ sơ khách và bản ghi chi tiết giao nhận, nếu
    // không healthcheck báo vi phạm toàn vẹn và trả not_ready. Trên PostgreSQL
    // ensureProductionDataSchema không chạy nên phải gọi phần vá dữ liệu ở đây.
    const { backfillExistingOrders } = await import("../../lib/data-integrity.ts");
    await backfillExistingOrders(database);
  }

  return {
    database: assertions(database),
    /** Thư mục tạm riêng của bài test — dùng cho UPLOAD_DIR và các tệp phụ khác. */
    directory,
    async cleanup() {
      await resetRuntimeDatabaseForTests();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      if (previousSqlite === undefined) delete process.env.SQLITE_PATH;
      else process.env.SQLITE_PATH = previousSqlite;
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    },
  };
}
