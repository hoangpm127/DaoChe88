/**
 * M11 — Khách hàng, điểm thưởng, ưu đãi, thông báo, đánh giá.
 *
 * Kiểm 6 tiêu chí Định nghĩa hoàn thành, kèm một điểm LỆCH có chủ đích:
 * tài khoản mới KHÔNG tự nhận đơn cũ của số điện thoại đó khi chưa có xác minh
 * (xem chú thích trong app/api/customers/session/route.ts). Bài kiểm dưới đây
 * khẳng định chính điều đó, vì nó là rào chắn rò rỉ dữ liệu cá nhân.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment } from "./helpers/portal-login.mjs";

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
  const runJobs = async () => (await (await request("/api/health")).json()).checks;
  // Gọi health một lần để schema được dựng trước khi test chèn thẳng vào DB.
  await runJobs();
  return { request, sql, runJobs };
}

async function register(request, { phone, password = "KhachHang-2026", fullName = "Khách hàng" }) {
  const response = await request("/api/customers/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "register", phone, password, fullName }),
  });
  return { status: response.status, body: await response.clone().json(), cookie: response.headers.get("set-cookie")?.split(";", 1)[0] };
}

async function login(request, { phone, password = "KhachHang-2026" }) {
  const response = await request("/api/customers/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  return { status: response.status, body: await response.clone().json(), cookie: response.headers.get("set-cookie")?.split(";", 1)[0] };
}

async function placeOrder(request, { cookie, phone = "0933000111", quantity = 2, promotionCode } = {}) {
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({
      command: "order.create",
      data: {
        clientReference: `m11-${crypto.randomUUID()}`,
        customerName: "Khách M11",
        customerPhone: phone,
        deliveryAddress: "Số 1 Nguyễn Hoàng, Mỹ Đình, Hà Nội",
        fulfillmentType: "pickup",
        siteId: "site-my-dinh",
        paymentMethod: "cash",
        ...(promotionCode ? { promotionCode } : {}),
        items: [{ productCode: "DC-CHEBUOI", quantity }],
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

test("khách đăng nhập máy mới thấy đơn của mình, điểm thưởng và trạng thái rỗng thật", async () => {
  const { request, sql } = await boot("m11-account");

  const registered = await register(request, { phone: "0933000111", fullName: "Nguyễn Thị Khách" });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));

  // Tài khoản mới chưa đặt gì: mọi danh sách phải RỖNG, không bịa voucher.
  const empty = await request("/api/customers/me", { headers: { cookie: registered.cookie } });
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.deepEqual(emptyBody.orders, []);
  assert.deepEqual(emptyBody.promotions, []);
  assert.deepEqual(emptyBody.notifications, []);
  assert.equal(emptyBody.customer.loyaltyPoints, 0);

  const order = await placeOrder(request, { cookie: registered.cookie, quantity: 7 });
  assert.equal(order.status, 201, JSON.stringify(order.body));

  // "Máy mới" = phiên hoàn toàn mới, chỉ có SĐT + mật khẩu.
  const fresh = await login(request, { phone: "0933000111" });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));

  const me = await request("/api/customers/me", { headers: { cookie: fresh.cookie } });
  const body = await me.json();
  assert.equal(body.orders.length, 1, "phải thấy đơn của chính mình trên máy mới");
  assert.equal(body.orders[0].order_code ?? body.orders[0].orderCode, order.body.result.orderCode);

  // Điểm thưởng: mặc định 1 điểm mỗi 1.000đ tiền hàng, không tính phí giao.
  const subtotal = order.body.result.amounts.subtotal;
  assert.equal(body.customer.loyaltyPoints, Math.floor(subtotal / 1000), "điểm phải khớp tiền hàng");
  assert.equal(Number((await sql("SELECT COUNT(*) AS n FROM loyalty_transactions WHERE transaction_type='earn'"))[0].n), 1);

  // Chưa đăng nhập thì không xem được.
  assert.equal((await request("/api/customers/me")).status, 401);

  // Cookie khách KHÔNG mở được portal vận hành.
  assert.equal((await request("/api/operations", { headers: { cookie: fresh.cookie } })).status, 401);
});

test("tài khoản mới KHÔNG tự nhận đơn cũ của số điện thoại chưa xác minh", async () => {
  const { request } = await boot("m11-privacy");

  // Khách vãng lai đặt đơn bằng số 0933000222 (chưa có tài khoản).
  const guestOrder = await placeOrder(request, { phone: "0933000222" });
  assert.equal(guestOrder.status, 201);

  // Người khác đăng ký bằng chính số đó. Chưa có kênh xác minh nên KHÔNG được
  // thấy đơn cũ — nếu thấy thì đăng ký bằng số người lạ là đọc được địa chỉ và
  // lịch sử mua của họ.
  const registered = await register(request, { phone: "0933000222" });
  assert.equal(registered.status, 201);

  const me = await request("/api/customers/me", { headers: { cookie: registered.cookie } });
  const body = await me.json();
  assert.equal(body.orders.length, 0, "đơn đặt trước khi có tài khoản không được lộ ra");
  assert.equal(body.customer.phoneVerified, false);
});

test("mã giảm giá: giảm đúng, ghi nhận, và không dùng lại được", async () => {
  const { request, sql } = await boot("m11-promo");
  const now = new Date();
  (await sql(
    `INSERT INTO promotions (id, code, name, promo_type, value, min_order_amount, usage_limit, usage_limit_per_customer, starts_at, ends_at, status, created_at)
     VALUES ('promo-test', 'GIAM10', 'Giảm 10%', 'percent', 1000, 0, NULL, 1, ?, ?, 'active', ?)`,
    new Date(now.getTime() - 3600_000).toISOString(),
    new Date(now.getTime() + 86_400_000).toISOString(),
    now.toISOString(),
  ));

  const registered = await register(request, { phone: "0933000333" });
  assert.equal(registered.status, 201);

  const withPromo = await placeOrder(request, { cookie: registered.cookie, quantity: 4, promotionCode: "GIAM10" });
  assert.equal(withPromo.status, 201, JSON.stringify(withPromo.body));
  const amounts = withPromo.body.result.amounts;
  assert.equal(amounts.discount, Math.floor(amounts.subtotal * 1000 / 10_000), "giảm đúng 10% tiền hàng");
  assert.equal(amounts.total, amounts.subtotal + amounts.deliveryFee - amounts.discount);

  const redemptions = (await sql("SELECT * FROM promotion_redemptions WHERE promotion_id = 'promo-test'"));
  assert.equal(redemptions.length, 1, "phải ghi promotion_redemptions");
  assert.equal(Number((await sql("SELECT used_count AS n FROM promotions WHERE id='promo-test'"))[0].n), 1);

  // Dùng lại lần hai: giới hạn mỗi khách một lần.
  const again = await placeOrder(request, { cookie: registered.cookie, quantity: 4, promotionCode: "GIAM10" });
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(again.body.code, "promotion_already_used");

  // Mã không tồn tại và mã hết hạn.
  const missing = await placeOrder(request, { cookie: registered.cookie, promotionCode: "KHONGCO" });
  assert.equal(missing.body.code, "promotion_not_found");

  (await sql("UPDATE promotions SET ends_at = ? WHERE id='promo-test'", new Date(now.getTime() - 1000).toISOString()));
  const expired = await register(request, { phone: "0933000334" });
  const expiredOrder = await placeOrder(request, { cookie: expired.cookie, promotionCode: "GIAM10" });
  assert.equal(expiredOrder.body.code, "promotion_expired");
});

test("tab Ưu đãi chỉ hiện voucher thật của tài khoản", async () => {
  const { request, sql } = await boot("m11-vouchers");
  const now = new Date();
  (await sql(
    `INSERT INTO promotions (id, code, name, promo_type, value, min_order_amount, usage_limit, usage_limit_per_customer, starts_at, ends_at, status, created_at)
     VALUES ('promo-live', 'CONHIEULUOT', 'Giảm 5%', 'percent', 500, 0, NULL, 1, ?, ?, 'active', ?)`,
    new Date(now.getTime() - 3600_000).toISOString(),
    new Date(now.getTime() + 86_400_000).toISOString(),
    now.toISOString(),
  ));
  (await sql(
    `INSERT INTO promotions (id, code, name, promo_type, value, min_order_amount, usage_limit, usage_limit_per_customer, starts_at, ends_at, status, created_at)
     VALUES ('promo-dead', 'DAHETHAN', 'Đã hết hạn', 'percent', 500, 0, NULL, 1, ?, ?, 'active', ?)`,
    new Date(now.getTime() - 86_400_000).toISOString(),
    new Date(now.getTime() - 3600_000).toISOString(),
    now.toISOString(),
  ));

  const registered = await register(request, { phone: "0933000444" });
  await placeOrder(request, { cookie: registered.cookie });

  const me = await request("/api/customers/me", { headers: { cookie: registered.cookie } });
  const codes = (await me.json()).promotions.map((entry) => entry.code);
  assert.ok(codes.includes("CONHIEULUOT"), "voucher còn hiệu lực phải hiện");
  assert.ok(!codes.includes("DAHETHAN"), "voucher hết hạn không được hiện");
});

test("thông báo đến khi đơn chuyển sang đang giao", async () => {
  const { request, sql, runJobs } = await boot("m11-notify");
  const registered = await register(request, { phone: "0933000555" });
  const order = await placeOrder(request, { cookie: registered.cookie });
  assert.equal(order.status, 201);

  // Chưa đổi trạng thái thì chưa có thông báo nào.
  await runJobs();
  let me = await (await request("/api/customers/me", { headers: { cookie: registered.cookie } })).json();
  assert.equal(me.notifications.length, 0);

  (await sql("UPDATE operation_orders SET order_status = 'delivering', updated_at = ? WHERE id = ?", new Date().toISOString(), order.body.result.orderId));
  await runJobs();

  me = await (await request("/api/customers/me", { headers: { cookie: registered.cookie } })).json();
  assert.equal(me.notifications.length, 1, "phải có đúng một thông báo");
  assert.equal(me.notifications[0].category, "order.delivering");

  // Job chạy lại không nhân bản thông báo.
  await runJobs();
  me = await (await request("/api/customers/me", { headers: { cookie: registered.cookie } })).json();
  assert.equal(me.notifications.length, 1, "chạy lại job không được nhân đôi thông báo");
});

test("đánh giá món: chỉ đơn của mình đã giao, một lần, và điểm trung bình đổi theo", async () => {
  const { request, sql } = await boot("m11-review");
  const registered = await register(request, { phone: "0933000666" });
  const order = await placeOrder(request, { cookie: registered.cookie });
  const orderId = order.body.result.orderId;
  const itemId = (await sql("SELECT id FROM operation_order_items WHERE order_id = ?", orderId))[0].id;

  // Chưa có đánh giá nào → danh sách rỗng, không bịa điểm.
  assert.deepEqual((await (await request("/api/customers/reviews")).json()).ratings, []);

  // Đơn chưa giao thì chưa đánh giá được.
  const tooEarly = await request("/api/customers/reviews", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: registered.cookie },
    body: JSON.stringify({ orderItemId: itemId, rating: 5 }),
  });
  assert.equal(tooEarly.status, 409);
  assert.equal((await tooEarly.json()).code, "review_order_not_delivered");

  (await sql("UPDATE operation_orders SET order_status = 'delivered', updated_at = ? WHERE id = ?", new Date().toISOString(), orderId));

  const submitted = await request("/api/customers/reviews", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: registered.cookie },
    body: JSON.stringify({ orderItemId: itemId, rating: 4, comment: "Ngon" }),
  });
  assert.equal(submitted.status, 201, await submitted.clone().text());

  const ratings = (await (await request("/api/customers/reviews")).json()).ratings;
  assert.equal(ratings.length, 1, "điểm trung bình phải xuất hiện sau đánh giá đầu tiên");
  assert.equal(Number(ratings[0].average), 4);

  // Không đánh giá hai lần cùng một dòng món.
  const duplicate = await request("/api/customers/reviews", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: registered.cookie },
    body: JSON.stringify({ orderItemId: itemId, rating: 1 }),
  });
  assert.equal(duplicate.status, 409);

  // Người khác không đánh giá được món trong đơn của mình.
  const stranger = await register(request, { phone: "0933000777" });
  const stealing = await request("/api/customers/reviews", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: stranger.cookie },
    body: JSON.stringify({ orderItemId: itemId, rating: 1 }),
  });
  assert.ok([403, 404].includes(stealing.status), `phải chặn đánh giá đơn người khác, nhận ${stealing.status}`);
});

test("sổ địa chỉ nằm ở tài khoản, không ở trình duyệt", async () => {
  const { request } = await boot("m11-addresses");
  {
    const phone = "0933000450";
    const registered = await register(request, { phone });
    assert.equal(registered.status, 201);

    // Chưa đăng nhập thì không đọc được sổ địa chỉ của ai cả.
    assert.equal((await request("/api/customers/addresses")).status, 401);

    // Tài khoản mới: RỖNG THẬT, không có địa chỉ mồi nào.
    const empty = await request("/api/customers/addresses", { headers: { cookie: registered.cookie } });
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).addresses, [], "tài khoản mới không được có địa chỉ dựng sẵn");

    // Từ khi có bản đồ định vị, địa chỉ mới không được lưu nếu chưa ghim tọa độ.
    const withoutCoordinates = await request("/api/customers/addresses", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: registered.cookie },
      body: JSON.stringify({ label: "Nhà · Nhà riêng", address: "Số 12 ngõ 4 Nguyễn Hoàng, Hà Nội" }),
    });
    assert.equal(withoutCoordinates.status, 400);
    assert.equal((await withoutCoordinates.json()).code, "address_coordinates_required");

    const firstWithCoordinates = await request("/api/customers/addresses", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: registered.cookie },
      body: JSON.stringify({
        label: "Nhà · Nhà riêng",
        address: "Số 12 ngõ 4 Nguyễn Hoàng, Hà Nội",
        latitude: 21.0312,
        longitude: 105.7788,
      }),
    });
    assert.equal(firstWithCoordinates.status, 201);
    const afterFirst = (await firstWithCoordinates.json()).addresses;
    assert.equal(afterFirst.length, 1);
    assert.ok(Math.abs(afterFirst[0].latitude - 21.0312) < 0.00001);
    assert.equal(afterFirst[0].isDefault, true, "địa chỉ đầu tiên tự thành mặc định");

    // Địa chỉ quá ngắn bị chặn ở máy chủ, không chỉ ở giao diện.
    const tooShort = await request("/api/customers/addresses", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: registered.cookie },
      body: JSON.stringify({ label: "Khác", address: "Hà Nội" }),
    });
    assert.equal(tooShort.status, 400);
    assert.equal((await tooShort.json()).code, "address_too_short");

    // Toạ độ ngoài khoảng hợp lệ cũng bị chặn.
    const badCoordinates = await request("/api/customers/addresses", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: registered.cookie },
      body: JSON.stringify({ label: "Khác", address: "Số 9 Phạm Hùng, Hà Nội", latitude: 999, longitude: 12 }),
    });
    assert.equal(badCoordinates.status, 400);
    assert.equal((await badCoordinates.json()).code, "invalid_coordinates");

    // Lưu kèm toạ độ thật thì đọc lại đúng.
    const withCoordinates = await request("/api/customers/addresses", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: registered.cookie },
      body: JSON.stringify({
        label: "Cơ quan · Văn phòng",
        address: "Tầng 5, số 9 Phạm Hùng, Nam Từ Liêm, Hà Nội",
        instructions: "Gọi khi tới sảnh",
        latitude: 21.028610,
        longitude: 105.778420,
      }),
    });
    assert.equal(withCoordinates.status, 201);
    const saved = (await withCoordinates.json()).addresses.find((row) => row.label.includes("Văn phòng"));
    assert.ok(Math.abs(saved.latitude - 21.02861) < 0.00001);
    assert.equal(saved.instructions, "Gọi khi tới sảnh");

    // Đăng nhập trên MÁY KHÁC vẫn thấy đủ — đây là điểm khác biệt với localStorage.
    const other = await login(request, { phone });
    const fromOtherDevice = await request("/api/customers/addresses", { headers: { cookie: other.cookie } });
    assert.equal((await fromOtherDevice.json()).addresses.length, 2, "đổi máy phải thấy đủ địa chỉ");

    // Khách KHÁC không đọc và không xoá được địa chỉ của người này.
    const stranger = await register(request, { phone: "0933000451", fullName: "Khách khác" });
    const strangerList = await request("/api/customers/addresses", { headers: { cookie: stranger.cookie } });
    assert.deepEqual((await strangerList.json()).addresses, [], "không được thấy địa chỉ của tài khoản khác");
    const stolenDelete = await request(`/api/customers/addresses?id=${encodeURIComponent(saved.id)}`, {
      method: "DELETE",
      headers: { cookie: stranger.cookie },
    });
    assert.equal(stolenDelete.status, 404, "đổi id trên URL không được xoá địa chỉ người khác");

    // Chủ tài khoản xoá được của chính mình.
    const removed = await request(`/api/customers/addresses?id=${encodeURIComponent(saved.id)}`, {
      method: "DELETE",
      headers: { cookie: registered.cookie },
    });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).addresses.length, 1);
  }
});
