/**
 * M5 — Đơn nhóm thật. Kiểm đúng 5 tiêu chí Định nghĩa hoàn thành:
 *
 *   1. Chốt phòng 8 người → 1 đơn, 8 dòng món có tên người, tồn giữ đúng 8 phần.
 *   2. Chủ phòng thấy hoa hồng sau khi đơn giao xong.
 *   3. Chủ phòng đặt một mình → không có hoa hồng.
 *   4. Đơn hủy → hoa hồng biến mất khỏi số sẵn sàng chi.
 *   5. Phòng hết hạn không ai đặt món → tự đóng, không giữ tồn.
 *
 * Job dọn phòng và đồng bộ hoa hồng chạy trong healthcheck, nên test gọi
 * /api/health thay vì gọi thẳng hàm — như vậy kiểm luôn phần nối job vào.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, ownerCookie } from "./helpers/portal-login.mjs";

async function boot(tag) {
  const { database } = await freshDatabase(tag, { seed: true });
  process.env.DEMO_SEED = "true";
  process.env.NODE_ENV = "test";
  process.env.SEPAY_BANK_CODE = "MB";
  process.env.SEPAY_BANK_ACCOUNT = "0000000000";
  configureAuthEnvironment();

  const server = await loadServer(tag);
  const request = (pathname, init) => server.fetch(new Request(`http://local.test${pathname}`, init));

  // Dùng chính database mà server đang phục vụ: cache runtime nằm trên globalThis
  // nên test và server thấy cùng một instance. PostgreSQL không có API đồng bộ.
  const sql = async (query, ...values) =>
    /^\s*select/i.test(query) ? database.all(query, ...values) : database.run(query, ...values);

  const runJobs = async () => {
    const response = await request("/api/health");
    return (await response.json()).checks;
  };

  const totals = async (referrerType, referrerId) => {
    const rows = (await sql(
      "SELECT status, SUM(commission_amount) AS total FROM order_referrals WHERE referrer_type = ? AND referrer_id = ? GROUP BY status",
      referrerType, referrerId,
    ));
    const result = { pending: 0, earned: 0, paid: 0, void: 0 };
    for (const row of rows) result[row.status] = Number(row.total || 0);
    return result;
  };

  return { request, sql, runJobs, totals };
}

/** Bật hoa hồng chủ phòng qua đúng API cấu hình M14, không sửa thẳng DB. */
async function setHostCommission(request, bps) {
  const cookie = await ownerCookie(request);
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ command: "settings.update", data: { key: "commission.group_host_bps", value: bps } }),
  });
  assert.equal(response.status, 200, `bật hoa hồng thất bại: ${await response.clone().text()}`);
}

async function createRoom(request, body) {
  const response = await request("/api/group-rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: "site-my-dinh", durationMinutes: 60, ...body }),
  });
  assert.equal(response.status, 201, `tạo phòng thất bại: ${await response.clone().text()}`);
  return response.json();
}

async function addItem(request, body) {
  const response = await request("/api/group-rooms", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "add-item", productId: "DC-CHEBUOI", quantity: 1, ...body }),
  });
  assert.equal(response.status, 200, `thêm món thất bại: ${await response.clone().text()}`);
  return response.json();
}

async function finalize(request, code, hostToken) {
  const response = await request("/api/group-rooms", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "finalize", code, hostToken }),
  });
  return { status: response.status, body: await response.json() };
}

test("chốt phòng 8 người ra đúng một đơn, 8 dòng món mang tên người", async () => {
  const { request, sql } = await boot("group-8");
  await setHostCommission(request, 300);

  const room = await createRoom(request, {
    office: "Văn phòng Nova",
    address: "Số 1 Nguyễn Hoàng, Mỹ Đình, Hà Nội",
    recipient: "Chủ phòng Lan",
    phone: "0912345678",
  });
  const code = room.room.code;
  const hostToken = room.hostToken;

  await addItem(request, { code, hostToken, guestName: "Chủ phòng Lan" });
  const guests = ["Minh", "Hà", "Tuấn", "Linh", "Nam", "Vy", "Sơn"];
  for (const guest of guests) await addItem(request, { code, guestName: guest, sweetness: "Ít ngọt" });

  const finalized = await finalize(request, code, hostToken);
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  const order = finalized.body.order;
  assert.ok(order.orderId, "phải sinh ra đơn thật");
  assert.equal(order.participants, 8);

  const orders = (await sql("SELECT id, channel FROM operation_orders WHERE group_room_code = ?", code));
  assert.equal(orders.length, 1, "phòng chỉ được sinh đúng MỘT đơn");
  assert.equal(orders[0].channel, "group-order");

  const items = (await sql("SELECT note, quantity FROM operation_order_items WHERE order_id = ?", order.orderId));
  assert.equal(items.length, 8, "mỗi người một dòng món để bếp in tem đúng tên");
  const notes = items.map((item) => item.note).join(" | ");
  for (const guest of guests) assert.ok(notes.includes(guest), `thiếu tên ${guest} trên tem`);
  assert.equal(items.reduce((sum, item) => sum + Number(item.quantity), 0), 8, "giữ đúng 8 phần");

  // Mỗi dòng phòng phải nối được sang dòng đơn thật, nếu không thì không biết
  // ai đã trả phần nào ở chế độ mỗi người tự trả.
  const linked = (await sql("SELECT COUNT(*) AS n FROM group_room_items WHERE room_code = ? AND order_item_id IS NOT NULL", code));
  assert.equal(Number(linked[0].n), 8);

  // Chốt lại lần nữa không được tạo đơn thứ hai.
  const again = await finalize(request, code, hostToken);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "group_room_already_finalized");
  assert.equal(Number((await sql("SELECT COUNT(*) AS n FROM operation_orders WHERE group_room_code = ?", code))[0].n), 1);
});

test("hoa hồng chủ phòng: có khi đủ người, không có khi đặt một mình", async () => {
  const { request, sql } = await boot("group-commission");
  await setHostCommission(request, 300); // 3%

  const shared = await createRoom(request, {
    office: "Phòng đủ người", address: "Số 2 Nguyễn Hoàng, Hà Nội",
    recipient: "Chủ phòng A", phone: "0912345001",
  });
  await addItem(request, { code: shared.room.code, hostToken: shared.hostToken, guestName: "Chủ phòng A" });
  for (const guest of ["Bình", "Chi", "Dũng"]) await addItem(request, { code: shared.room.code, guestName: guest });

  const sharedResult = await finalize(request, shared.room.code, shared.hostToken);
  assert.equal(sharedResult.status, 200);
  assert.equal(sharedResult.body.order.hostCommission.eligible, true);
  assert.equal(sharedResult.body.order.hostCommission.bps, 300);

  const items = (await sql("SELECT price, quantity, is_host FROM group_room_items WHERE room_code = ?", shared.room.code));
  const guestBase = items.filter((item) => Number(item.is_host) !== 1)
    .reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  assert.equal(
    sharedResult.body.order.hostCommission.amount,
    Math.floor(guestBase * 300 / 10_000),
    "hoa hồng chỉ tính trên phần của người khác, không tính phần chủ phòng",
  );

  // --- Phòng chỉ có chủ phòng: không hoa hồng ---
  const alone = await createRoom(request, {
    office: "Phòng một mình", address: "Số 3 Nguyễn Hoàng, Hà Nội",
    recipient: "Chủ phòng B", phone: "0912345002",
  });
  await addItem(request, { code: alone.room.code, hostToken: alone.hostToken, guestName: "Chủ phòng B", quantity: 2 });
  const aloneResult = await finalize(request, alone.room.code, alone.hostToken);
  assert.equal(aloneResult.status, 200);
  assert.equal(aloneResult.body.order.hostCommission.eligible, false, "đặt một mình thì không có hoa hồng");
  assert.equal(aloneResult.body.order.hostCommission.amount, 0);
  assert.equal(
    Number((await sql("SELECT COUNT(*) AS n FROM order_referrals WHERE order_id = ?", aloneResult.body.order.orderId))[0].n),
    0,
    "không được ghi bản ghi hoa hồng nào",
  );
});

test("hoa hồng chỉ sẵn sàng chi sau khi giao xong, và biến mất khi đơn hủy", async () => {
  const { request, sql, runJobs, totals } = await boot("group-lifecycle");
  await setHostCommission(request, 500);

  const room = await createRoom(request, {
    office: "Phòng vòng đời", address: "Số 4 Nguyễn Hoàng, Hà Nội",
    recipient: "Chủ phòng C", phone: "0912345003",
  });
  await addItem(request, { code: room.room.code, hostToken: room.hostToken, guestName: "Chủ phòng C" });
  for (const guest of ["Em", "Phong", "Giang"]) await addItem(request, { code: room.room.code, guestName: guest });

  const result = await finalize(request, room.room.code, room.hostToken);
  assert.equal(result.status, 200);
  const { orderId } = result.body.order;
  const hostId = "+84912345003";

  assert.ok((await totals("group_host", hostId)).pending > 0, "hoa hồng phải ở trạng thái chờ ngay sau khi chốt");
  assert.equal((await totals("group_host", hostId)).earned, 0, "chưa giao xong thì chưa sẵn sàng chi");

  // Giao xong nhưng VỪA MỚI giao → còn trong thời hạn khiếu nại.
  (await sql("UPDATE operation_orders SET order_status = 'delivered', updated_at = ? WHERE id = ?", new Date().toISOString(), orderId));
  await runJobs();
  assert.equal((await totals("group_host", hostId)).earned, 0, "còn trong thời hạn khiếu nại thì chưa được chi");

  // Lùi thời điểm giao về 2 ngày trước để vượt thời hạn khiếu nại mặc định 24 giờ.
  (await sql(
    "UPDATE operation_orders SET updated_at = ? WHERE id = ?",
    new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(), orderId,
  ));
  await runJobs();
  assert.ok((await totals("group_host", hostId)).earned > 0, "hết thời hạn khiếu nại thì hoa hồng phải sẵn sàng chi");

  // Đơn bị hủy → hoa hồng rời khỏi số sẵn sàng chi.
  (await sql("UPDATE operation_orders SET order_status = 'cancelled', updated_at = ? WHERE id = ?", new Date().toISOString(), orderId));
  await runJobs();
  const afterCancel = (await totals("group_host", hostId));
  assert.equal(afterCancel.earned, 0, "đơn hủy thì hoa hồng phải rời khỏi số sẵn sàng chi");
  assert.ok(afterCancel.void > 0);
});

test("phòng hết hạn tự đóng và không giữ tồn", async () => {
  const { request, sql, runJobs } = await boot("group-expiry");

  const room = await createRoom(request, {
    office: "Phòng hết hạn", address: "Số 5 Nguyễn Hoàng, Hà Nội",
    recipient: "Chủ phòng D", phone: "0912345004", durationMinutes: 15,
  });
  (await sql("UPDATE group_rooms SET expires_at = ? WHERE code = ?", Date.now() - 1000, room.room.code));

  const checks = await runJobs();
  assert.ok(checks.groupRooms.expired >= 1, "healthcheck phải đóng phòng quá hạn");

  const rows = (await sql("SELECT status, order_id FROM group_rooms WHERE code = ?", room.room.code));
  assert.equal(rows[0].status, "expired");
  assert.equal(rows[0].order_id, null, "phòng hết hạn không được sinh đơn");

  // Không có đơn ⇒ không có gì giữ tồn. Tồn chỉ bị giữ khi đã thành đơn thật.
  assert.equal(Number((await sql("SELECT COUNT(*) AS n FROM operation_orders WHERE group_room_code = ?", room.room.code))[0].n), 0);
  assert.equal(
    Number((await sql(
      "SELECT COUNT(*) AS n FROM catalog_stock_reservations WHERE order_id IN (SELECT id FROM operation_orders WHERE group_room_code = ?)",
      room.room.code,
    ))[0].n),
    0,
    "không được giữ tồn cho phòng đã hết hạn",
  );
});

test("chỉ chủ phòng được chốt, và cờ chủ phòng không tin từ trình duyệt", async () => {
  const { request, sql } = await boot("group-guard");
  await setHostCommission(request, 300);

  const room = await createRoom(request, {
    office: "Phòng bảo vệ", address: "Số 6 Nguyễn Hoàng, Hà Nội",
    recipient: "Chủ phòng E", phone: "0912345005",
  });
  await addItem(request, { code: room.room.code, hostToken: room.hostToken, guestName: "Chủ phòng E" });

  // Khách tự khai isHost để né bị trừ khỏi phần tính hoa hồng — phải bị bỏ qua.
  await addItem(request, { code: room.room.code, guestName: "Kẻ giả mạo", isHost: true });

  const rows = (await sql("SELECT guest_name, is_host FROM group_room_items WHERE room_code = ?", room.room.code));
  const impostor = rows.find((row) => row.guest_name === "Kẻ giả mạo");
  assert.equal(Number(impostor.is_host), 0, "cờ chủ phòng chỉ được đặt bằng hostToken");

  const stolen = await finalize(request, room.room.code, "token-gia");
  assert.equal(stolen.status, 403);
});
