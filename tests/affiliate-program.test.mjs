/**
 * M6 — Affiliate. Kiểm đúng 5 tiêu chí Định nghĩa hoàn thành:
 *
 *   1. Affiliate đăng nhập bằng SĐT trên máy mới → thấy đủ lịch sử hoa hồng.
 *   2. Khách bấm link ?ref= hôm nay, đặt hàng sau 3 ngày → vẫn được quy kết.
 *   3. Đơn hoàn tiền → hoa hồng biến mất khỏi số "sẵn sàng chi".
 *   4. Chạy chi trả tháng → ra file chuyển khoản, tổng khớp sổ.
 *   5. Affiliate tự đặt bằng mã của mình → bị từ chối.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, ownerCookie } from "./helpers/portal-login.mjs";

const { taxWithheldFor, TAX_WITHHOLDING_THRESHOLD_VND } = await import("../lib/commands-payout.ts");

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
  return { request, sql, runJobs };
}

/** Tạo hồ sơ cộng tác viên rồi duyệt — đi đúng đường thật, không chèn thẳng DB. */
async function approveAffiliate(request, { name, phone }) {
  const applied = await request("/api/customer-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestType: "affiliate_application",
      name, phone,
      email: `${phone}@example.com`,
      subject: "Đăng ký cộng tác viên",
      details: { community: "Văn phòng" },
    }),
  });
  assert.equal(applied.status, 201, `nộp hồ sơ thất bại: ${await applied.clone().text()}`);
  const requestId = (await applied.json()).requestId;

  const cookie = await ownerCookie(request);
  const approved = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      command: "affiliate.approve",
      data: {
        affiliateId: requestId,
        commissionBps: 800,
        payoutBankCode: "MB",
        payoutAccountNumber: "0123456789",
        payoutAccountName: "NGUYEN VAN A",
      },
    }),
  });
  assert.equal(approved.status, 200, `duyệt hồ sơ thất bại: ${await approved.clone().text()}`);
  return (await approved.json()).result;
}

async function placeOrder(request, { affiliateCode, headers = {}, customerPhone = "0977000123" } = {}) {
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      command: "order.create",
      data: {
        clientReference: `aff-${crypto.randomUUID()}`,
        customerName: "Khách kiểm thử",
        customerPhone,
        deliveryAddress: "Số 1 Nguyễn Hoàng, Mỹ Đình, Hà Nội",
        fulfillmentType: "pickup",
        siteId: "site-my-dinh",
        paymentMethod: "cash",
        ...(affiliateCode ? { affiliateCode } : {}),
        items: [{ productCode: "TP-HN", quantity: 2 }],
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

test("cộng tác viên đăng nhập trên máy mới và thấy đủ lịch sử hoa hồng", async () => {
  const { request } = await boot("aff-login");
  const approved = await approveAffiliate(request, { name: "Nguyễn Văn A", phone: "0961000111" });
  assert.ok(approved.temporaryPassword, "duyệt hồ sơ phải cấp tài khoản đăng nhập");
  assert.ok(approved.code, "phải sinh mã giới thiệu");

  const order = await placeOrder(request, { affiliateCode: approved.code });
  assert.equal(order.status, 201, JSON.stringify(order.body));

  // "Máy mới" = không mang theo cookie nào, chỉ có SĐT và mật khẩu.
  const login = await request("/api/affiliates/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "0961000111", password: approved.temporaryPassword }),
  });
  assert.equal(login.status, 200, `đăng nhập thất bại: ${await login.clone().text()}`);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];

  const account = await request("/api/affiliates/account", { headers: { cookie } });
  assert.equal(account.status, 200);
  const payload = await account.json();
  // /api/affiliates/account nay tra dung hinh dang ma giao dien dung, de viec
  // noi man hinh khong phai them mot lop anh xa thu hai.
  assert.equal(payload.affiliate.status, "active");
  assert.equal(payload.affiliate.code, approved.code);
  assert.equal(payload.affiliate.recent.length, 1, "phải thấy đơn vừa quy kết");
  assert.ok(payload.affiliate.summary.pendingAmount > 0, "hoa hồng đơn mới phải ở trạng thái chờ");
  assert.ok(payload.affiliate.summary.salesAmount > 0, "doanh số phải khớp đơn đã quy kết");

  // Cookie cộng tác viên KHÔNG được mở portal vận hành.
  const portalProbe = await request("/api/operations", { headers: { cookie } });
  assert.equal(portalProbe.status, 401, "phiên cộng tác viên không được vào portal");

  // Chưa đăng nhập thì không xem được.
  assert.equal((await request("/api/affiliates/account")).status, 401);

  // Đường cũ đọc hồ sơ theo ?request=…&token= trên URL đã bị XOÁ, không phải chỉ
  // ngừng gọi. Còn tồn tại nghĩa là lỗ hổng vẫn còn: ai có link là xem được hoa
  // hồng mà không cần mật khẩu, và không thu hồi được.
  assert.equal(
    (await request("/api/affiliates/status?request=00000000-0000-4000-8000-000000000000&token=" + "0".repeat(64))).status,
    404,
    "endpoint đọc-theo-link phải không còn tồn tại",
  );
});

test("khách bấm link ref hôm nay, đặt hàng ba ngày sau vẫn được quy kết", async () => {
  const { request, sql } = await boot("aff-window");
  const approved = await approveAffiliate(request, { name: "Trần Thị B", phone: "0961000222" });

  const visitorHeaders = { "x-forwarded-for": "203.0.113.77", "user-agent": "tp88-test-browser" };

  const tracked = await request("/api/affiliates/track", {
    method: "POST",
    headers: { "content-type": "application/json", ...visitorHeaders },
    body: JSON.stringify({ code: approved.code }),
  });
  assert.equal(tracked.status, 200);
  assert.equal((await tracked.json()).recorded, true);

  // Lùi lượt bấm về 3 ngày trước; cửa sổ quy kết mặc định là 7 ngày.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  (await sql("UPDATE affiliate_clicks SET landed_at = ? WHERE code = ?", threeDaysAgo, approved.code));

  // Khách KHÔNG nhập mã, chỉ đặt món từ cùng thiết bị.
  const order = await placeOrder(request, { headers: visitorHeaders });
  assert.equal(order.status, 201, JSON.stringify(order.body));

  const referrals = (await sql(
    "SELECT referral_code, commission_amount FROM order_referrals WHERE order_id = ? AND referrer_type = 'affiliate'",
    order.body.result.orderId,
  ));
  assert.equal(referrals.length, 1, "đơn trong cửa sổ quy kết phải được tính cho người giới thiệu");
  assert.equal(referrals[0].referral_code, approved.code);

  // Lượt bấm đã dùng thì không quy kết tiếp cho đơn sau.
  const second = await placeOrder(request, { headers: visitorHeaders });
  assert.equal(second.status, 201);
  assert.equal(
    (await sql("SELECT COUNT(*) AS n FROM order_referrals WHERE order_id = ?", second.body.result.orderId))[0].n,
    0,
    "một lượt bấm chỉ quy kết được một đơn",
  );

  // Lượt bấm hết hạn thì không còn quy kết.
  (await sql("UPDATE affiliate_clicks SET expires_at = ? WHERE code = ?", new Date(Date.now() - 1000).toISOString(), approved.code));
  const expired = await placeOrder(request, { headers: visitorHeaders });
  assert.equal(
    (await sql("SELECT COUNT(*) AS n FROM order_referrals WHERE order_id = ?", expired.body.result.orderId))[0].n,
    0,
    "ngoài cửa sổ quy kết thì không tính hoa hồng",
  );
});

test("cộng tác viên tự đặt bằng mã của mình thì bị từ chối", async () => {
  const { request } = await boot("aff-self");
  const approved = await approveAffiliate(request, { name: "Lê Văn C", phone: "0961000333" });

  const selfOrder = await placeOrder(request, { affiliateCode: approved.code, customerPhone: "0961000333" });
  assert.equal(selfOrder.status, 409, JSON.stringify(selfOrder.body));
  assert.equal(selfOrder.body.code, "affiliate_self_referral");
});

test("chi trả theo lô: tổng khớp sổ, khấu trừ thuế đúng, không trả hai lần", async () => {
  const { request, sql, runJobs } = await boot("aff-payout");
  const approved = await approveAffiliate(request, { name: "Phạm Thị D", phone: "0961000444" });

  // Ba đơn đủ lớn để tổng hoa hồng vượt ngưỡng khấu trừ thuế 2.000.000đ.
  const orders = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "order.create",
        data: {
          clientReference: `payout-${crypto.randomUUID()}`,
          customerName: `Khách ${index}`,
          customerPhone: `097700${index}999`,
          deliveryAddress: "Số 1 Nguyễn Hoàng, Mỹ Đình, Hà Nội",
          fulfillmentType: "pickup",
          siteId: "site-my-dinh",
          paymentMethod: "cash",
          affiliateCode: approved.code,
          items: [{ productCode: "TP-HN", quantity: 99 }],
        },
      }),
    });
    assert.equal(response.status, 201, await response.clone().text());
    orders.push((await response.json()).result.orderId);
  }

  // Giao xong và vượt thời hạn khiếu nại → hoa hồng sẵn sàng chi.
  const longAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  for (const orderId of orders) {
    (await sql("UPDATE operation_orders SET order_status = 'delivered', updated_at = ? WHERE id = ?", longAgo, orderId));
  }
  await runJobs();

  const earned = (await sql(
    "SELECT SUM(commission_amount) AS total, COUNT(*) AS n FROM order_referrals WHERE referrer_type='affiliate' AND status='earned'",
  ))[0];
  assert.equal(Number(earned.n), 3, "cả ba đơn phải sẵn sàng chi");

  const cookie = await ownerCookie(request);
  const created = await request("/api/payouts", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      action: "create",
      counterpartyType: "affiliate",
      periodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      periodEnd: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }),
  });
  assert.equal(created.status, 201, `tạo lô thất bại: ${await created.clone().text()}`);
  const batch = await created.json();
  assert.equal(batch.entryCount, 3);

  // Tổng chi = tổng hoa hồng trừ thuế đã khấu trừ. Bất biến này đúng ở mọi mức.
  const gross = Number(earned.total);
  assert.equal(batch.totalAmount + batch.taxWithheld, gross, "tổng chi cộng thuế phải khớp sổ hoa hồng");
  assert.equal(
    batch.taxWithheld,
    taxWithheldFor(gross),
    "thuế khấu trừ phải đúng theo ngưỡng, không nhiều không ít",
  );

  // File chuyển khoản cho ngân hàng.
  const csvResponse = await request(`/api/payouts?batchId=${batch.batchId}&format=csv`, { headers: { cookie } });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type") || "", /text\/csv/);
  // Đọc byte thô: Response.text() tự bỏ BOM theo chuẩn giải mã UTF-8, nên kiểm
  // bằng chuỗi sẽ luôn trượt dù file có BOM thật.
  const csvBytes = new Uint8Array(await csvResponse.clone().arrayBuffer());
  assert.deepEqual(
    [csvBytes[0], csvBytes[1], csvBytes[2]],
    [0xef, 0xbb, 0xbf],
    "phải có BOM để Excel không vỡ tiếng Việt",
  );
  const csv = await csvResponse.text();
  assert.match(csv, /so_tai_khoan,ten_tai_khoan,ma_ngan_hang,so_tien/);
  assert.match(csv, /0123456789/);

  // Gom lần hai trong cùng kỳ: không còn gì để trả.
  const again = await request("/api/payouts", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      action: "create",
      counterpartyType: "affiliate",
      periodStart: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      periodEnd: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }),
  });
  assert.equal(again.status, 409, "không được gom lại khoản đã nằm trong lô khác");
  assert.equal((await again.json()).code, "payout_nothing_to_pay");

  // Đánh dấu đã trả cần mã giao dịch.
  const withoutReference = await request("/api/payouts", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "mark-paid", batchId: batch.batchId }),
  });
  assert.equal(withoutReference.status, 400);

  const paid = await request("/api/payouts", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "mark-paid", batchId: batch.batchId, providerReference: "FT26082100123" }),
  });
  assert.equal(paid.status, 200);
  assert.equal(
    Number((await sql("SELECT COUNT(*) AS n FROM order_referrals WHERE status = 'paid'"))[0].n),
    3,
    "hoa hồng đã trả phải chuyển sang trạng thái paid",
  );
});

test("khấu trừ thuế TNCN đúng ngưỡng", () => {
  // Chi trả dưới ngưỡng thì không khấu trừ; từ ngưỡng trở lên khấu trừ 10%.
  // Đây là nghĩa vụ của bên chi trả nên phải tính tự động, không để kế toán nhớ.
  assert.equal(taxWithheldFor(0), 0);
  assert.equal(taxWithheldFor(TAX_WITHHOLDING_THRESHOLD_VND - 1), 0);
  assert.equal(taxWithheldFor(TAX_WITHHOLDING_THRESHOLD_VND), TAX_WITHHOLDING_THRESHOLD_VND / 10);
  assert.equal(taxWithheldFor(5_000_000), 500_000);
});

test("đơn hoàn tiền thì hoa hồng rời khỏi số sẵn sàng chi", async () => {
  const { request, sql, runJobs } = await boot("aff-refund");
  const approved = await approveAffiliate(request, { name: "Vũ Văn E", phone: "0961000555" });

  const order = await placeOrder(request, { affiliateCode: approved.code });
  assert.equal(order.status, 201);
  const orderId = order.body.result.orderId;

  const longAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  (await sql("UPDATE operation_orders SET order_status = 'delivered', updated_at = ? WHERE id = ?", longAgo, orderId));
  await runJobs();
  assert.equal(Number((await sql("SELECT COUNT(*) AS n FROM order_referrals WHERE order_id = ? AND status='earned'", orderId))[0].n), 1);

  (await sql("UPDATE operation_orders SET payment_status = 'refunded', updated_at = ? WHERE id = ?", new Date().toISOString(), orderId));
  await runJobs();

  const after = (await sql("SELECT status FROM order_referrals WHERE order_id = ?", orderId))[0];
  assert.equal(after.status, "void", "đơn hoàn tiền thì hoa hồng phải bị hủy");
});

test("chỉ admin tổng và kế toán được chi trả hoa hồng", async () => {
  const { request } = await boot("aff-rbac");
  assert.equal((await request("/api/payouts")).status, 401, "khách ẩn danh không xem được");

  const { portalCookie } = await import("./helpers/portal-login.mjs");
  const staffCookie = await portalCookie(request, "store-staff", { siteIds: ["site-my-dinh"] });
  const attempt = await request("/api/payouts", { headers: { cookie: staffCookie } });
  assert.equal(attempt.status, 403, "nhân viên bán hàng không được chạm vào chi trả");
});
