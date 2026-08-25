/**
 * Danh tính chạy trên PostgreSQL thật (pglite), không chỉ trên SQLite.
 *
 * Production dùng PostgreSQL, còn phần lớn test khác chạy trên SQLite cho nhanh.
 * Hai phương ngữ khác nhau ở đúng những chỗ mã xác thực đụng tới: ON CONFLICT,
 * chỉ mục duy nhất một phần, và kiểu trả về của COUNT(*). Bài này chạy toàn bộ
 * vòng đời tài khoản trên PostgreSQL để những khác biệt đó lộ ra ở đây thay vì
 * lộ ra lúc triển khai.
 *
 * Schema lấy từ drizzle/ — đúng đường mà production dùng.
 */

import assert from "node:assert/strict";
import test from "node:test";

const { createPostgresRuntime } = await import("../db/postgres-runtime.ts");
const { loadMigrations, runMigrations } = await import("../db/migrate.ts");
import { fileURLToPath } from "node:url";
import path from "node:path";
const { createUser, verifyCredentials, resolveScope, listRoleAssignments, AuthError } = await import("../lib/auth/users.ts");
const { issueSession, readSession, revokeAllSessions } = await import("../lib/auth/sessions.ts");
const { checkRateLimit, recordFailure, clearRateLimit } = await import("../lib/auth/rate-limit.ts");
const { bootstrapOwnerAccount } = await import("../lib/auth/bootstrap.ts");

const drizzleDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const migrations = await loadMigrations(drizzleDirectory);

async function freshDatabase() {
  const database = await createPostgresRuntime("pglite://memory");
  await runMigrations(database, migrations);
  return database;
}

test("vòng đời tài khoản chạy đúng trên PostgreSQL", async () => {
  const database = await freshDatabase();

  const created = await createUser(database, {
    fullName: "Chủ cửa hàng Mỹ Đình",
    phone: "0901234567",
    password: "MatKhauBanDau-2026",
    roles: [{ role: "store-owner", siteId: "site-my-dinh" }, { role: "store-owner", siteId: "site-cau-giay" }],
    createdBy: "test",
  });

  const user = await verifyCredentials(database, { phone: "0901234567", password: "MatKhauBanDau-2026" });
  assert.equal(user.id, created.userId);

  await assert.rejects(
    () => verifyCredentials(database, { phone: "0901234567", password: "sai" }),
    (cause) => cause instanceof AuthError && cause.code === "invalid_credentials",
  );

  // Phạm vi gộp đúng nhiều điểm được gán, và chỉ những điểm đó.
  const assignments = await listRoleAssignments(database, created.userId);
  assert.equal(assignments.length, 2);
  const scope = await resolveScope(database, created.userId, "store-owner");
  assert.equal(scope.isGlobal, false);
  assert.deepEqual([...scope.siteIds].sort(), ["site-cau-giay", "site-my-dinh"]);

  // Vai trò chưa được gán thì không mở được phiên, dù biết đúng mật khẩu.
  assert.equal(await resolveScope(database, created.userId, "owner"), null);
  await assert.rejects(
    () => issueSession(database, { userId: created.userId, role: "owner" }),
    (cause) => cause instanceof AuthError && cause.code === "role_not_assigned",
  );

  const issued = await issueSession(database, { userId: created.userId, role: "store-owner" });
  const read = await readSession(database, issued.token);
  assert.equal(read.userId, created.userId);
  assert.deepEqual([...read.scope.siteIds].sort(), ["site-cau-giay", "site-my-dinh"]);

  assert.equal(await revokeAllSessions(database, created.userId), 1);
  assert.equal(await readSession(database, issued.token), null, "phiên đã thu hồi phải hết hiệu lực ngay");
});

test("giới hạn dò mật khẩu dùng đúng cú pháp upsert của PostgreSQL", async () => {
  const database = await freshDatabase();
  const key = "login:phone:0901234567";

  assert.equal((await checkRateLimit(database, key)).blocked, false);
  let blocked = false;
  for (let attempt = 0; attempt < 12 && !blocked; attempt += 1) {
    blocked = (await recordFailure(database, key)).blocked;
  }
  assert.equal(blocked, true, "phải chặn sau một số lần thử sai");
  assert.equal((await checkRateLimit(database, key)).blocked, true);
  assert.ok((await checkRateLimit(database, key)).retryAfterSeconds > 0);

  await clearRateLimit(database, key);
  assert.equal((await checkRateLimit(database, key)).blocked, false, "đăng nhập thành công phải xóa bộ đếm");
});

test("bootstrap chỉ tạo admin tổng khi hệ thống còn trống", async () => {
  const database = await freshDatabase();
  const previous = {
    phone: process.env.BOOTSTRAP_OWNER_PHONE,
    password: process.env.BOOTSTRAP_OWNER_PASSWORD,
  };
  process.env.BOOTSTRAP_OWNER_PHONE = "0900000009";
  process.env.BOOTSTRAP_OWNER_PASSWORD = "BootstrapTest-2026";

  try {
    const first = await bootstrapOwnerAccount(database);
    assert.equal(first.created, true);

    const owner = await verifyCredentials(database, { phone: "0900000009", password: "BootstrapTest-2026" });
    assert.equal(Number(owner.mustChangePassword), 1, "mật khẩu từ biến môi trường phải buộc đổi ngay");
    const scope = await resolveScope(database, owner.id, "owner");
    assert.equal(scope.isGlobal, true);

    // Gọi lại không được tạo thêm tài khoản nào.
    const second = await bootstrapOwnerAccount(database);
    assert.equal(second.created, false);
    assert.equal(second.reason, "already-initialised");

    // Kể cả khi ba request đến cùng lúc trên một hệ thống còn trống thì cũng chỉ
    // một tài khoản được tạo. Đếm số dòng trong bảng chứ không đếm cờ trả về:
    // các lời gọi song song dùng chung một kết quả nên cờ nào cũng như nhau.
    const other = await freshDatabase();
    await Promise.all([
      bootstrapOwnerAccount(other),
      bootstrapOwnerAccount(other),
      bootstrapOwnerAccount(other),
    ]);
    const total = await other.prepare("SELECT COUNT(*) AS total FROM users").all();
    assert.equal(Number(total.results[0].total), 1, "ba lời gọi song song chỉ được tạo một tài khoản");
  } finally {
    process.env.BOOTSTRAP_OWNER_PHONE = previous.phone;
    process.env.BOOTSTRAP_OWNER_PASSWORD = previous.password;
  }
});
