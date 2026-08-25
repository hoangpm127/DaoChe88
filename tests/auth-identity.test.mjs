import assert from "node:assert/strict";
import test from "node:test";

const { createPostgresRuntime } = await import("../db/postgres-runtime.ts");
const { loadMigrations, runMigrations } = await import("../db/migrate.ts");
const { createUser, resolveScope, setPassword, verifyCredentials, listRoleAssignments } =
  await import("../lib/auth/users.ts");
const { issueSession, readSession, revokeSession, revokeAllSessions, listActiveSessions } =
  await import("../lib/auth/sessions.ts");
const { toCanonicalRole, isCanonicalRole, canonicalRoleIds, isPortalCapableRole } = await import("../lib/auth/roles.ts");

/** Database sạch cho mỗi test, chạy đủ migration thật để schema khớp production. */
async function freshDatabase() {
  const database = await createPostgresRuntime("pglite://memory");
  const migrations = await loadMigrations(new URL("../drizzle", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  await runMigrations(database, migrations);
  return database;
}

test("ánh xạ 11 vai trò cũ về đúng 7 vai trò chuẩn", () => {
  // Quyết định Q8 là gộp 11 vai trò VẬN HÀNH cũ xuống 7. Con số cần khoá lại là
  // số vai trò vận hành, không phải tổng số vai trò tồn tại: M11 thêm "customer"
  // cho khách có tài khoản — vai trò phía khách, không mở được portal vận hành.
  const operatingRoles = canonicalRoleIds.filter((role) => role !== "customer");
  assert.equal(operatingRoles.length, 7, "số vai trò vận hành không được phình trở lại");
  assert.equal(isPortalCapableRole("customer"), false, "khách không được vào portal vận hành");
  assert.equal(toCanonicalRole("super-admin"), "owner");
  assert.equal(toCanonicalRole("region-manager"), "owner");
  assert.equal(toCanonicalRole("manager"), "store-owner");
  assert.equal(toCanonicalRole("distribution"), "store-owner");
  assert.equal(toCanonicalRole("dispatch"), "store-owner");
  assert.equal(toCanonicalRole("founder"), "store-owner");
  assert.equal(toCanonicalRole("store"), "store-staff");
  assert.equal(toCanonicalRole("kitchen"), "kitchen");
  assert.equal(toCanonicalRole("shipper"), "shipper");
  assert.equal(toCanonicalRole("finance"), "accountant");
  assert.equal(toCanonicalRole("control"), "accountant");
  // Vai trò chuẩn truyền vào thì giữ nguyên; vai trò lạ trả null.
  assert.equal(toCanonicalRole("owner"), "owner");
  assert.equal(toCanonicalRole("khong-ton-tai"), null);
  assert.equal(isCanonicalRole("super-admin"), false, "vai trò cũ KHÔNG phải vai trò chuẩn");
});

test("tạo tài khoản, đăng nhập, và số điện thoại được chuẩn hóa", async () => {
  const db = await freshDatabase();

  const created = await createUser(db, {
    fullName: "Nguyễn Thu Hà",
    phone: "0901880088",
    roles: [{ role: "store-staff", siteId: "site-my-dinh" }],
    createdBy: "test",
  });
  assert.ok(created.userId);
  assert.ok(created.temporaryPassword, "không truyền mật khẩu thì phải sinh mật khẩu tạm");

  // Đăng nhập bằng cả hai dạng số điện thoại phải ra cùng tài khoản.
  for (const phone of ["0901880088", "+84901880088", "84901880088"]) {
    const user = await verifyCredentials(db, { phone, password: created.temporaryPassword });
    assert.equal(user.id, created.userId, `dạng ${phone} phải ra cùng tài khoản`);
  }

  assert.equal(Number((await verifyCredentials(db, { phone: "0901880088", password: created.temporaryPassword })).mustChangePassword), 1,
    "tài khoản do admin tạo phải bị buộc đổi mật khẩu lần đầu");

  await assert.rejects(
    verifyCredentials(db, { phone: "0901880088", password: "sai-mat-khau" }),
    /Số điện thoại hoặc mật khẩu không đúng/,
  );
  // Không tiết lộ số nào đã đăng ký: số lạ trả CÙNG thông báo lỗi.
  await assert.rejects(
    verifyCredentials(db, { phone: "0900000000", password: "bất kỳ" }),
    /Số điện thoại hoặc mật khẩu không đúng/,
  );

  await db.close();
});

test("không mở được phiên với vai trò chưa được gán", async () => {
  const db = await freshDatabase();
  const created = await createUser(db, {
    fullName: "Trần Minh Quân",
    phone: "0902880088",
    password: "chebuoinamroi2026",
    roles: [{ role: "store-staff", siteId: "site-keangnam" }],
    createdBy: "test",
  });

  // Vai trò được gán thì mở được.
  const ok = await issueSession(db, { userId: created.userId, role: "store-staff" });
  assert.equal(ok.session.role, "store-staff");

  // ĐÂY LÀ CHỐT CHẶN QUAN TRỌNG NHẤT: xin vai trò không được gán phải bị từ chối.
  await assert.rejects(
    issueSession(db, { userId: created.userId, role: "owner" }),
    /chưa được gán vai trò này/,
  );
  await assert.rejects(
    issueSession(db, { userId: created.userId, role: "accountant" }),
    /chưa được gán vai trò này/,
  );

  await db.close();
});

test("phạm vi dữ liệu đọc từ phân công, không hardcode", async () => {
  const db = await freshDatabase();

  const staff = await createUser(db, {
    fullName: "Nhân viên hai điểm",
    phone: "0903880088",
    password: "chebuoinamroi2026",
    roles: [
      { role: "store-owner", siteId: "site-my-dinh" },
      { role: "store-owner", siteId: "site-keangnam" },
    ],
    createdBy: "test",
  });
  const scoped = await resolveScope(db, staff.userId, "store-owner");
  assert.equal(scoped.isGlobal, false);
  assert.deepEqual([...scoped.siteIds].sort(), ["site-keangnam", "site-my-dinh"]);

  const owner = await createUser(db, {
    fullName: "Mai Việt Hoàng",
    phone: "0904880088",
    password: "chebuoinamroi2026",
    roles: [{ role: "owner", siteId: null }],
    createdBy: "test",
  });
  const global = await resolveScope(db, owner.userId, "owner");
  assert.equal(global.isGlobal, true, "site_id NULL nghĩa là toàn hệ thống");

  assert.equal(await resolveScope(db, staff.userId, "owner"), null);
  assert.equal((await listRoleAssignments(db, staff.userId)).length, 2);

  await db.close();
});

test("phiên thu hồi được ngay, và khóa tài khoản làm mọi phiên hết hiệu lực", async () => {
  const db = await freshDatabase();
  const created = await createUser(db, {
    fullName: "Đức Anh",
    phone: "0905880088",
    password: "chebuoinamroi2026",
    roles: [{ role: "shipper", siteId: "site-my-dinh" }],
    createdBy: "test",
  });

  const first = await issueSession(db, { userId: created.userId, role: "shipper", deviceLabel: "Điện thoại A" });
  const second = await issueSession(db, { userId: created.userId, role: "shipper", deviceLabel: "Điện thoại B" });

  assert.ok(await readSession(db, first.token));
  assert.ok(await readSession(db, second.token));
  assert.equal((await listActiveSessions(db, created.userId)).length, 2);

  // Thu hồi một thiết bị: thiết bị kia không bị ảnh hưởng.
  await revokeSession(db, first.session.sessionId);
  assert.equal(await readSession(db, first.token), null, "phiên bị thu hồi phải mất hiệu lực NGAY");
  assert.ok(await readSession(db, second.token), "thiết bị còn lại vẫn hoạt động");

  // Khóa tài khoản: mọi phiên còn lại mất hiệu lực dù chưa hết hạn.
  await db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind(created.userId).run();
  assert.equal(await readSession(db, second.token), null, "khóa tài khoản phải chặn mọi phiên đang mở");

  await db.close();
});

test("đổi mật khẩu thu hồi toàn bộ phiên đang mở", async () => {
  const db = await freshDatabase();
  const created = await createUser(db, {
    fullName: "Phạm Hải Yến",
    phone: "0906880088",
    password: "chebuoinamroi2026",
    roles: [{ role: "kitchen", siteId: "site-central-kitchen" }],
    createdBy: "test",
  });

  const session = await issueSession(db, { userId: created.userId, role: "kitchen" });
  assert.ok(await readSession(db, session.token));

  await setPassword(db, created.userId, "matkhaumoi2026xyz");
  const revoked = await revokeAllSessions(db, created.userId);
  assert.equal(revoked, 1);
  assert.equal(await readSession(db, session.token), null, "đổi mật khẩu xong thì phiên cũ phải chết");

  // Mật khẩu cũ không dùng được nữa, mật khẩu mới thì được.
  await assert.rejects(verifyCredentials(db, { phone: "0906880088", password: "chebuoinamroi2026" }), /không đúng/);
  const user = await verifyCredentials(db, { phone: "0906880088", password: "matkhaumoi2026xyz" });
  assert.equal(Number(user.mustChangePassword), 0, "đặt mật khẩu mới thì tắt cờ buộc đổi");

  await db.close();
});

test("phạm vi được giải lại mỗi request nên gỡ quyền có hiệu lực ngay", async () => {
  const db = await freshDatabase();
  const created = await createUser(db, {
    fullName: "Chủ hai điểm",
    phone: "0907880088",
    password: "chebuoinamroi2026",
    roles: [
      { role: "store-owner", siteId: "site-my-dinh" },
      { role: "store-owner", siteId: "site-keangnam" },
    ],
    createdBy: "test",
  });

  const session = await issueSession(db, { userId: created.userId, role: "store-owner" });
  assert.equal((await readSession(db, session.token)).scope.siteIds.length, 2);

  // Admin gỡ một cửa hàng khỏi tài khoản trong lúc phiên đang mở.
  await db
    .prepare("UPDATE user_role_assignments SET status = 'revoked' WHERE user_id = ? AND site_id = ?")
    .bind(created.userId, "site-keangnam")
    .run();

  const after = await readSession(db, session.token);
  assert.deepEqual(after.scope.siteIds, ["site-my-dinh"], "phạm vi phải thu hẹp ngay, không đợi phiên hết hạn");

  // Gỡ nốt vai trò thì phiên mất hiệu lực hoàn toàn.
  await db.prepare("UPDATE user_role_assignments SET status = 'revoked' WHERE user_id = ?").bind(created.userId).run();
  assert.equal(await readSession(db, session.token), null);

  await db.close();
});

test("token giả hoặc sai định dạng không mở được phiên", async () => {
  const db = await freshDatabase();
  for (const bad of ["", "abc", "z".repeat(64), "0".repeat(63), "0".repeat(65), "../../etc/passwd"]) {
    assert.equal(await readSession(db, bad), null, `token "${bad.slice(0, 12)}" phải bị từ chối`);
  }
  await db.close();
});
