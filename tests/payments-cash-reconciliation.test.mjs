import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, createAccount, login, ownerCookie, portalCookie } from "./helpers/portal-login.mjs";

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const webhookSecret = "daoche-m8-sepay-webhook-secret-at-least-32-characters";

function signedWebhook(payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("http://localhost/api/webhooks/sepay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sepay-timestamp": String(timestamp),
      "x-sepay-signature": `sha256=${signature}`,
    },
    body,
  });
}

async function command(request, cookie, commandName, data, expected = 200, key = crypto.randomUUID()) {
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "idempotency-key": key },
    body: JSON.stringify({ command: commandName, data }),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, JSON.stringify(payload));
  return payload;
}

test("M8 đối soát 20 đơn, hoàn tiền từng phần và kiểm quỹ ca bằng chứng từ", async () => {
  configureAuthEnvironment();
  const { database } = await freshDatabase("m8", { seed: true });
  process.env.DEMO_SEED = "true";
  process.env.ORDER_DATA_MODE = "test";
  process.env.SEPAY_BANK_ACCOUNT = "88888888188";
  process.env.SEPAY_BANK_CODE = "TPBank";
  process.env.SEPAY_PAYMENT_PREFIX = "DCHE";
  process.env.SEPAY_WEBHOOK_AUTH_MODE = "hmac";
  process.env.SEPAY_WEBHOOK_SECRET = webhookSecret;

  const worker = await loadServer("payments-cash-reconciliation-test");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  assert.equal((await request("/api/health")).status, 200);
  const owner = await ownerCookie(request);
  const accountant = await portalCookie(request, "accountant");

  const allDay = JSON.stringify(Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [["00:00", "23:59"]]])));
  await database.run("UPDATE operation_sites SET opening_hours_json = ?, capacity_per_hour = 100, status = 'open', accepts_orders = 1 WHERE id = 'site-my-dinh'", allDay);
  // INSERT OR REPLACE la cu phap rieng SQLite; PostgreSQL dung ON CONFLICT.
  await database.run(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status)
    VALUES ('m8-stock', 'site-my-dinh', 'DC-BUOI', 100, 0, 1, 'available')
    ON CONFLICT (id) DO UPDATE SET on_hand = excluded.on_hand, reserved = excluded.reserved,
      track_stock = excluded.track_stock, status = excluded.status`);

  const opened = await command(request, owner, "shift.open", { siteId: "site-my-dinh", openingCash: 100_000, note: "Ca kiểm thử M8" });
  const shiftId = opened.result.shiftId;
  const cashOrders = [];
  const bankOrders = [];

  for (let index = 0; index < 20; index += 1) {
    const paymentMethod = index < 10 ? "cash" : "bank_transfer";
    const response = await request("/api/operations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `m8-order-${index}`,
        "x-forwarded-for": `198.51.100.${index + 1}`,
      },
      body: JSON.stringify({
        command: "order.create",
        data: {
          customerName: `Khách M8 ${index + 1}`,
          customerPhone: `0908${String(index + 1).padStart(6, "0")}`,
          deliveryAddress: "Mỹ Đình, Hà Nội",
          fulfillmentType: "pickup",
          paymentMethod,
          siteId: "site-my-dinh",
          payerLabel: `M8-${index + 1}`,
          items: [{ productCode: "DC-BUOI", quantity: 1 }],
        },
      }),
    });
    const created = await response.json();
    assert.equal(response.status, 201, JSON.stringify(created));
    assert.equal(created.result.amounts.total, 28_000);
    if (paymentMethod === "cash") cashOrders.push(created.result);
    else bankOrders.push(created.result);
  }

  for (const [index, order] of bankOrders.entries()) {
    const payload = {
      id: 8100 + index,
      gateway: "TPBank",
      transactionDate: `2026-08-18 10:${String(index).padStart(2, "0")}:00`,
      accountNumber: "88888888188",
      code: order.payment.paymentCode,
      content: `${order.payment.paymentCode} THANH TOAN M8`,
      transferType: "in",
      description: "Khách M8 chuyển khoản",
      transferAmount: 28_000,
      accumulated: (index + 1) * 28_000,
      referenceCode: `FT-M8-${index}`,
    };
    const response = await worker.fetch(signedWebhook(payload), runtimeEnv, executionContext);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }

  for (const order of cashOrders) {
    for (const nextStatus of ["accepted", "preparing", "ready", "delivered"]) {
      await command(request, owner, "order.advance", { orderId: order.orderId, nextStatus });
    }
  }

  await command(request, owner, "cash.movement.create", {
    siteId: "site-my-dinh",
    movementType: "float_in",
    amount: 20_000,
    reason: "Bổ sung tiền lẻ đầu ca",
  });
  await command(request, owner, "cash.movement.create", {
    siteId: "site-my-dinh",
    movementType: "drop",
    amount: 10_000,
    reason: "Rút bớt tiền khỏi két",
  });
  const closed = await command(request, owner, "shift.close", { siteId: "site-my-dinh", shiftId, countedCash: 390_000 });
  assert.equal(closed.result.expectedCash, 390_000);
  assert.equal(closed.result.variance, 0);
  assert.deepEqual(closed.result.movements, { sales: 280_000, refunds: 0, drops: 10_000, floatIn: 20_000, payouts: 0, corrections: 0 });

  const reportResponse = await request(`/api/reports/shift/${shiftId}`, { headers: { cookie: owner } });
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200, JSON.stringify(report));
  assert.equal(report.report.billCount, 10);
  assert.equal(report.report.cashRevenue, 280_000);
  assert.equal(report.report.expectedCash, 390_000);
  const printResponse = await request(`/api/reports/shift/${shiftId}?format=print`, { headers: { cookie: owner } });
  assert.equal(printResponse.status, 200);
  assert.match(printResponse.headers.get("content-type"), /^text\/html/);
  assert.match(await printResponse.text(), /Báo cáo cuối ca/);

  const secondShift = await command(request, owner, "shift.open", { siteId: "site-my-dinh", openingCash: 100_000 });
  const unexplained = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner },
    body: JSON.stringify({ command: "shift.close", data: { siteId: "site-my-dinh", shiftId: secondShift.result.shiftId, countedCash: 50_000 } }),
  });
  assert.equal(unexplained.status, 400);
  assert.equal((await unexplained.json()).code, "shift_variance_reason_required");
  const explained = await command(request, owner, "shift.close", {
    siteId: "site-my-dinh",
    shiftId: secondShift.result.shiftId,
    countedCash: 50_000,
    note: "Thiếu tiền đang chờ quản lý xác minh",
  });
  assert.equal(explained.result.requiresExplanation, true);
  assert.ok(explained.result.alertId);

  const partial = await command(request, accountant, "payment.refund", {
    orderId: bankOrders[0].orderId,
    amount: 5_000,
    reason: "Hoàn một phần theo thỏa thuận",
    providerReference: "RF-M8-PARTIAL-1",
  });
  assert.equal(partial.result.refundType, "partial");
  assert.equal(partial.result.paymentStatus, "partially_refunded");
  assert.equal(partial.result.orderStatus, "new");
  assert.equal(partial.result.refundableRemaining, 23_000);
  const duplicatePartial = await command(request, accountant, "payment.refund", {
    orderId: bankOrders[0].orderId,
    amount: 5_000,
    reason: "Hoàn một phần theo thỏa thuận",
    providerReference: "RF-M8-PARTIAL-1",
  }, 200, "m8-refund-duplicate-call");
  assert.equal(duplicatePartial.result.duplicate, true);
  const excessive = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: accountant, "idempotency-key": "m8-refund-too-large" },
    body: JSON.stringify({ command: "payment.refund", data: { orderId: bankOrders[0].orderId, amount: 23_001, reason: "Thử hoàn quá số đã nhận", providerReference: "RF-M8-TOO-LARGE" } }),
  });
  assert.equal(excessive.status, 409);
  assert.equal((await excessive.json()).code, "refund_amount_exceeded");

  const csvLines = ["providerTransactionId,transactionDate,amount,content,paymentCode"];
  for (const [index, order] of bankOrders.entries()) {
    csvLines.push(`${8100 + index},2026-08-18 10:${String(index).padStart(2, "0")}:00,28000,${order.payment.paymentCode} THANH TOAN M8,${order.payment.paymentCode}`);
  }
  const reconciliationResponse = await request("/api/reconciliations/bank?statementDate=2026-08-18&accountNumber=88888888188&openingBalance=0&closingBalance=280000", {
    method: "POST",
    headers: { "content-type": "text/csv", cookie: accountant },
    body: csvLines.join("\n"),
  });
  const reconciliation = await reconciliationResponse.json();
  assert.equal(reconciliationResponse.status, 201, JSON.stringify(reconciliation));
  assert.equal(reconciliation.result.status, "balanced");
  assert.equal(reconciliation.result.matchedCount, 10);
  assert.equal(reconciliation.result.unmatchedCount, 0);

  const mismatchResponse = await request("/api/reconciliations/bank", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: accountant },
    body: JSON.stringify({
      statementDate: "2026-08-18",
      accountNumber: "88888888188",
      openingBalance: 0,
      closingBalance: 14_000,
      rows: [{ providerTransactionId: "8100", transactionDate: "2026-08-18T10:00:00Z", amount: 14_000, content: `${bankOrders[0].payment.paymentCode} SAI TIEN`, paymentCode: bankOrders[0].payment.paymentCode }],
    }),
  });
  const mismatch = await mismatchResponse.json();
  assert.equal(mismatchResponse.status, 201, JSON.stringify(mismatch));
  assert.equal(mismatch.result.status, "discrepancy");
  assert.ok(mismatch.result.unmatchedCount >= 1);
  assert.ok(mismatch.result.alertId);

  const shipperAccount = await createAccount(request, { role: "shipper", fullName: "Shipper COD M8" });
  await database.run("UPDATE operation_staff SET user_id = ?, status = 'available' WHERE id = 'shipper-tuan'", shipperAccount.userId);
  const shipper = await login(request, { phone: shipperAccount.phone, password: shipperAccount.password, role: "shipper" });
  const receivingShift = await command(request, owner, "shift.open", { siteId: "site-my-dinh", openingCash: 0, note: "Nhận tiền COD" });
  const codCreateResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "m8-cod-order", "x-forwarded-for": "198.51.100.250" },
    body: JSON.stringify({ command: "order.create", data: {
      customerName: "Khách COD M8",
      customerPhone: "0908999999",
      deliveryAddress: "Mỹ Đình, Hà Nội",
      fulfillmentType: "delivery",
      paymentMethod: "cash",
      siteId: "site-my-dinh",
      items: [{ productCode: "DC-BUOI", quantity: 1 }],
    } }),
  });
  const codCreated = await codCreateResponse.json();
  assert.equal(codCreateResponse.status, 201, JSON.stringify(codCreated));
  for (const nextStatus of ["accepted", "preparing", "ready"]) {
    await command(request, owner, "order.advance", { orderId: codCreated.result.orderId, nextStatus });
  }
  await command(request, owner, "order.assign", { orderId: codCreated.result.orderId, shipperId: "shipper-tuan" });
  for (const nextStatus of ["picked_up", "delivering"]) {
    await command(request, shipper, "order.advance", { orderId: codCreated.result.orderId, nextStatus });
  }
  const deliveryOtp = (await database.get("SELECT delivery_otp_code FROM operation_orders WHERE id = ?", codCreated.result.orderId)).delivery_otp_code;
  await command(request, shipper, "order.advance", { orderId: codCreated.result.orderId, nextStatus: "delivered", deliveryOtp });
  const heldResponse = await request("/api/reports/cash-held", { headers: { cookie: shipper } });
  const held = await heldResponse.json();
  assert.equal(heldResponse.status, 200, JSON.stringify(held));
  assert.equal(held.totalHeld, 43_000);
  assert.equal(held.holders.length, 1);
  assert.equal(held.holders[0].actorUserId, shipperAccount.userId);
  const remitted = await command(request, shipper, "cash.remit", { siteId: "site-my-dinh", reason: "Nộp COD cho cửa hàng" });
  assert.equal(remitted.result.amount, 43_000);
  assert.equal(remitted.result.movementCount, 1);
  const afterRemit = await (await request("/api/reports/cash-held", { headers: { cookie: shipper } })).json();
  assert.equal(afterRemit.totalHeld, 0);
  const receivingClose = await command(request, owner, "shift.close", {
    siteId: "site-my-dinh",
    shiftId: receivingShift.result.shiftId,
    countedCash: 43_000,
  });
  assert.equal(receivingClose.result.expectedCash, 43_000);

  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_orders WHERE customer_name LIKE 'Khách M8 %'")).count, 20);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM cash_movements WHERE shift_id = ? AND movement_type = 'sale'", shiftId)).count, 10);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM payment_attempts WHERE provider = 'sepay' AND site_id = 'site-my-dinh' AND payer_label LIKE 'M8-%'")).count, 10);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM payment_refunds WHERE order_id = ? AND refund_type = 'partial'", bankOrders[0].orderId)).count, 1);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_alerts WHERE category IN ('cash-variance', 'bank-reconciliation')")).count, 2);
  const codMovement = (await database.get("SELECT shift_id, remitted_shift_id, remitted_at, actor_user_id FROM cash_movements WHERE order_id = ? AND movement_type = 'sale'", codCreated.result.orderId));
  assert.equal(codMovement.shift_id, null);
  assert.equal(codMovement.remitted_shift_id, receivingShift.result.shiftId);
  assert.ok(codMovement.remitted_at);
  assert.equal(codMovement.actor_user_id, shipperAccount.userId);
});
