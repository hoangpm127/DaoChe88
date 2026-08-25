import assert from "node:assert/strict";
import test from "node:test";

// Nạp thẳng nguồn TypeScript: adapter không phụ thuộc gì vào bundle của app,
// nên test được cô lập khỏi tầng HTTP. Cần Node chạy với --experimental-strip-types.
const { createPostgresRuntime, toPostgresPlaceholders } = await import("../db/postgres-runtime.ts");

test("đổi placeholder ? sang $n mà không đụng vào chuỗi, định danh và chú thích", () => {
  assert.equal(
    toPostgresPlaceholders("UPDATE t SET a = ?, b = ? WHERE id = ?"),
    "UPDATE t SET a = $1, b = $2 WHERE id = $3",
  );

  // Dấu ? trong chuỗi phải giữ nguyên — đây là chỗ dễ hỏng nhất.
  assert.equal(
    toPostgresPlaceholders("INSERT INTO t (note, id) VALUES ('Sao ạ?', ?)"),
    "INSERT INTO t (note, id) VALUES ('Sao ạ?', $1)",
  );

  // Dấu nháy được thoát bằng '' không được làm lệch bộ quét.
  assert.equal(
    toPostgresPlaceholders("SELECT ? WHERE x = 'it''s a ? mark' AND y = ?"),
    "SELECT $1 WHERE x = 'it''s a ? mark' AND y = $2",
  );

  assert.equal(
    toPostgresPlaceholders('SELECT ? FROM "cột ? lạ" WHERE z = ?'),
    'SELECT $1 FROM "cột ? lạ" WHERE z = $2',
  );

  assert.equal(
    toPostgresPlaceholders("SELECT ? -- có ? trong chú thích\n, ?"),
    "SELECT $1 -- có ? trong chú thích\n, $2",
  );

  assert.equal(
    toPostgresPlaceholders("SELECT ? /* ? khối */ , ?"),
    "SELECT $1 /* ? khối */ , $2",
  );
});

test("adapter Postgres giữ đúng ngữ nghĩa changes, batch-transaction và khóa lạc quan", async () => {
  const db = await createPostgresRuntime("pglite://memory");

  await db.prepare(`CREATE TABLE don_hang (
    id TEXT PRIMARY KEY,
    trang_thai TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tien INTEGER NOT NULL DEFAULT 0
  )`).run();

  const insert = await db.prepare("INSERT INTO don_hang (id, trang_thai, updated_at, tien) VALUES (?, ?, ?, ?)")
    .bind("dh-1", "new", "2026-08-17T00:00:00.000Z", 15000).run();
  assert.equal(insert.meta.changes, 1, "INSERT phải báo đúng 1 dòng bị ảnh hưởng");

  const read = await db.prepare("SELECT * FROM don_hang WHERE id = ?").bind("dh-1").all();
  assert.equal(read.results.length, 1);
  assert.equal(read.results[0].trang_thai, "new");

  const firstValue = await db.prepare("SELECT trang_thai FROM don_hang WHERE id = ?").bind("dh-1").first("trang_thai");
  assert.equal(firstValue, "new");

  // --- Khóa lạc quan: đúng một bên thắng ---
  const stale = "2026-08-17T00:00:00.000Z";
  const winner = await db.prepare("UPDATE don_hang SET trang_thai = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
    .bind("accepted", "2026-08-17T00:01:00.000Z", "dh-1", stale).run();
  assert.equal(winner.meta.changes, 1, "bên thắng phải thấy changes = 1");

  const loser = await db.prepare("UPDATE don_hang SET trang_thai = ?, updated_at = ? WHERE id = ? AND updated_at = ?")
    .bind("preparing", "2026-08-17T00:02:00.000Z", "dh-1", stale).run();
  assert.equal(loser.meta.changes, 0, "bên thua PHẢI thấy changes = 0 — nếu khác, khóa lạc quan hỏng âm thầm");

  // --- batch() phải là MỘT transaction: lỗi giữa chừng thì rollback sạch ---
  await assert.rejects(
    db.batch([
      db.prepare("INSERT INTO don_hang (id, trang_thai, updated_at) VALUES (?, ?, ?)").bind("dh-2", "new", "t"),
      db.prepare("INSERT INTO don_hang (id, trang_thai, updated_at) VALUES (?, ?, ?)").bind("dh-1", "trùng khóa", "t"),
    ]),
    "batch có câu lỗi phải ném lỗi",
  );

  const afterRollback = await db.prepare("SELECT id FROM don_hang WHERE id = ?").bind("dh-2").all();
  assert.equal(afterRollback.results.length, 0, "dh-2 phải bị rollback — batch không được ghi một nửa");

  // --- batch() thành công trả kết quả theo đúng thứ tự ---
  const ok = await db.batch([
    db.prepare("INSERT INTO don_hang (id, trang_thai, updated_at) VALUES (?, ?, ?)").bind("dh-3", "new", "t"),
    db.prepare("UPDATE don_hang SET tien = ? WHERE id = ?").bind(99000, "dh-3"),
    db.prepare("UPDATE don_hang SET tien = ? WHERE id = ?").bind(1, "không-tồn-tại"),
  ]);
  assert.equal(ok.length, 3);
  assert.equal(ok[0].meta.changes, 1);
  assert.equal(ok[1].meta.changes, 1);
  assert.equal(ok[2].meta.changes, 0, "câu không khớp dòng nào phải trả changes = 0");

  // --- Dấu ? trong dữ liệu thật không được diễn giải thành placeholder ---
  await db.prepare("INSERT INTO don_hang (id, trang_thai, updated_at) VALUES (?, ?, ?)")
    .bind("dh-4", "Giao lúc mấy giờ?", "t").run();
  const noteRow = await db.prepare("SELECT trang_thai FROM don_hang WHERE id = ?").bind("dh-4").all();
  assert.equal(noteRow.results[0].trang_thai, "Giao lúc mấy giờ?");

  await db.close();
});

test("dịch phương ngữ SQLite → PostgreSQL ở tầng câu lệnh", async () => {
  const { toPostgresDialect } = await import("../db/postgres-runtime.ts");

  assert.equal(
    toPostgresDialect("UPDATE t SET n = MAX(0, n - 1) WHERE id = ?"),
    "UPDATE t SET n = GREATEST(0, n - 1) WHERE id = ?",
  );
  // Hàm gộp MAX(cột) KHÔNG được đụng tới.
  assert.equal(toPostgresDialect("SELECT MAX(version) FROM m"), "SELECT MAX(version) FROM m");

  assert.equal(
    toPostgresDialect("INSERT OR IGNORE INTO t (id) VALUES (?)"),
    "INSERT INTO t (id) VALUES (?) ON CONFLICT DO NOTHING",
  );
  assert.equal(
    toPostgresDialect("INSERT OR IGNORE INTO t (id) SELECT id FROM s WHERE x = ?"),
    "INSERT INTO t (id) SELECT id FROM s WHERE x = ? ON CONFLICT DO NOTHING",
  );
  // Câu đã có ON CONFLICT … DO UPDATE thì giữ nguyên, không nối thêm.
  const upsert = "INSERT INTO t (id) VALUES (?) ON CONFLICT(id) DO UPDATE SET id = excluded.id";
  assert.equal(toPostgresDialect(upsert), upsert);
});

test("adapter chạy được INSERT OR IGNORE, MAX(0,…) và boolean trên Postgres thật", async () => {
  const db = await createPostgresRuntime("pglite://memory");
  await db.prepare("CREATE TABLE kho (id TEXT PRIMARY KEY, ton INTEGER NOT NULL, la_test INTEGER NOT NULL DEFAULT 1, CONSTRAINT co_valid CHECK (la_test IN (0, 1)))").run();

  // boolean từ code nghiệp vụ phải vào cột INTEGER thành 0/1
  await db.prepare("INSERT INTO kho (id, ton, la_test) VALUES (?, ?, ?)").bind("k1", 5, true).run();
  await db.prepare("INSERT INTO kho (id, ton, la_test) VALUES (?, ?, ?)").bind("k2", 1, false).run();
  const flags = await db.prepare("SELECT id, la_test FROM kho ORDER BY id").all();
  assert.deepEqual(flags.results.map((r) => r.la_test), [1, 0]);

  // INSERT OR IGNORE: lần hai không lỗi và không ghi đè
  const dup = await db.prepare("INSERT OR IGNORE INTO kho (id, ton) VALUES (?, ?)").bind("k1", 999).run();
  assert.equal(dup.meta.changes, 0, "bản ghi trùng phải bị bỏ qua, không ném lỗi");
  const kept = await db.prepare("SELECT ton FROM kho WHERE id = ?").bind("k1").first("ton");
  assert.equal(kept, 5, "giá trị cũ phải được giữ nguyên");

  // MAX(0, …) không cho tồn xuống âm
  await db.prepare("UPDATE kho SET ton = MAX(0, ton - ?) WHERE id = ?").bind(100, "k2").run();
  assert.equal(await db.prepare("SELECT ton FROM kho WHERE id = ?").bind("k2").first("ton"), 0);

  await db.close();
});

test("migration lưu được epoch mili-giây của phòng nhóm trên PostgreSQL", async () => {
  const db = await createPostgresRuntime("pglite://memory");
  const { loadMigrations, runMigrations } = await import("../db/migrate.ts");
  const drizzleDirectory = new URL("../drizzle", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  await runMigrations(db, await loadMigrations(drizzleDirectory));

  const expiresAt = Date.now() + 60 * 60 * 1000;
  await db.prepare(
    "INSERT INTO group_rooms (code, host_token, office, expires_at) VALUES (?, ?, ?, ?)",
  ).bind("ROOM-BIGINT", "host-token", "Van phong test", expiresAt).run();

  assert.equal(
    Number(await db.prepare("SELECT expires_at FROM group_rooms WHERE code = ?").bind("ROOM-BIGINT").first("expires_at")),
    expiresAt,
  );
  await assert.doesNotReject(
    db.prepare("UPDATE group_rooms SET status = 'expired' WHERE expires_at <= ?").bind(Date.now()).run(),
  );

  // So với hằng số mà healthcheck dùng, thay vì số cứng: con số này đổi mỗi lần
  // thêm migration, còn điều cần khẳng định là "đã chạy hết".
  const { POSTGRES_MIGRATION_VERSION } = await import("../lib/data-integrity.ts");
  assert.equal(Number(await db.prepare("SELECT MAX(version) AS version FROM runtime_schema_migrations").first("version")), POSTGRES_MIGRATION_VERSION);
  for (const table of ["rate_limit_buckets", "stream_connections", "pii_access_log", "monitor_incidents", "privacy_consents"]) {
    assert.equal(Number(await db.prepare("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_name = ?").bind(table).first("count")), 1, `thiếu bảng ${table}`);
  }
  const requiredIndexes = [
    "operation_orders_site_status_created_idx",
    "operation_orders_active_promised_idx",
    "finance_ledger_location_occurred_type_idx",
    "catalog_site_stock_site_status_idx",
  ];
  const indexRows = await db.prepare(`SELECT indexname FROM pg_indexes WHERE indexname IN (${requiredIndexes.map(() => "?").join(",")})`).bind(...requiredIndexes).all();
  assert.deepEqual(new Set(indexRows.results.map((row) => row.indexname)), new Set(requiredIndexes));

  await db.prepare(`INSERT INTO operation_orders
    (id, order_code, customer_name, delivery_address, site_id, subtotal_amount, delivery_fee_amount, discount_amount, total_amount, item_count, promised_at, created_at, updated_at)
    SELECT 'index-order-' || value, 'TP88-INDEX-' || value, 'Index test', 'Hà Nội',
      CASE WHEN value % 2 = 0 THEN 'site-index-a' ELSE 'site-index-b' END,
      0, 0, 0, 0, 1, '2026-08-22T00:00:00.000Z',
      '2026-08-21T12:00:00.000Z', '2026-08-21T12:00:00.000Z'
    FROM generate_series(1, 2000) AS value`).run();
  await db.prepare("ANALYZE operation_orders").run();
  await db.prepare("SET enable_seqscan = off").run();
  const explain = await db.prepare(`EXPLAIN SELECT id FROM operation_orders
    WHERE site_id = ? AND order_status = 'new'
    ORDER BY created_at DESC, id DESC LIMIT 50`).bind("site-index-a").all();
  const plan = explain.results.flatMap((row) => Object.values(row)).join("\n");
  assert.match(plan, /operation_orders_site_status_created_idx/, "truy vấn scoped phải dùng composite index");

  await db.close();
});
