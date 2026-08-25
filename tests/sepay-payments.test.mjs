import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { portalCookie, configureAuthEnvironment } from "./helpers/portal-login.mjs";

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const webhookSecret = "daoche-sepay-test-webhook-secret-at-least-32-characters";

async function loadWorker() {
  return loadServer("sepay-payments-test");
}

function signedWebhook(pathname, payload, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sepay-timestamp": String(timestamp),
      "x-sepay-signature": `sha256=${signature}`,
    },
    body,
  });
}

test("SePay payment flow stores normalized test orders and reconciles signed webhooks idempotently", async () => {
  const { database } = await freshDatabase("sepay", { seed: true });
  process.env.DEMO_SEED = "true";
  configureAuthEnvironment();
  process.env.ORDER_DATA_MODE = "test";
  process.env.SEPAY_BANK_ACCOUNT = "88888888188";
  process.env.SEPAY_BANK_CODE = "TPBank";
  process.env.SEPAY_PAYMENT_PREFIX = "DCHE";
  process.env.SEPAY_WEBHOOK_AUTH_MODE = "hmac";
  process.env.SEPAY_WEBHOOK_SECRET = webhookSecret;

  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  assert.equal((await request("/api/health")).status, 200);
  const createResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        orderId: "DR-SEPAY-TEST-001",
        orderCode: "DR-SEPAY-TEST-001",
        customerName: "Khách test SePay",
        customerPhone: "0900000088",
        customerEmail: "test@example.com",
        deliveryAddress: "Mỹ Đình, Nam Từ Liêm, Hà Nội",
        fulfillmentType: "delivery",
        paymentMethod: "qr",
        siteId: "site-my-dinh",
        items: [{ productCode: "DC-BUOI", quantity: 2, unitPrice: 1 }],
      },
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.result.amounts.subtotal, 56000);
  assert.equal(created.result.amounts.deliveryFee, 15000);
  assert.equal(created.result.amounts.total, 71000);
  assert.equal(created.result.payment.amount, 71000);
  assert.equal(created.result.payment.bankCode, "TPBank");
  assert.equal(created.result.payment.bankAccount, "88888888188");
  assert.match(created.result.payment.paymentCode, /^DCHE[A-F0-9]{12}$/);
  assert.match(created.result.payment.qrUrl, /^https:\/\/vietqr\.app\/img\?/);
  assert.notEqual(created.result.orderId, "DR-SEPAY-TEST-001");
  assert.match(created.result.orderCode, /^DC-\d{6}-[A-F0-9]{10}$/);
  const primaryOrderId = created.result.orderId;
  const paymentCode = created.result.payment.paymentCode;
  assert.equal((await database.get("SELECT status FROM finance_order_allocations WHERE order_id = ?", primaryOrderId)).status, "pending");

  const probeResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        orderId: "SEPAY-2K-PROBE-001",
        orderCode: "SEPAY-2K-PROBE-001",
        customerName: "SePay 2K Webhook Test",
        deliveryAddress: "Kiểm thử webhook SePay — không làm món, không giao hàng",
        fulfillmentType: "pickup",
        paymentMethod: "bank_transfer",
        siteId: "site-my-dinh",
        items: [{ productCode: "TEST-SEPAY-2K", quantity: 1 }],
      },
    }),
  });
  assert.equal(probeResponse.status, 201);
  const probe = await probeResponse.json();
  assert.equal(probe.result.amounts.subtotal, 2000);
  assert.equal(probe.result.amounts.deliveryFee, 0);
  assert.equal(probe.result.amounts.total, 2000);
  assert.equal(probe.result.payment.amount, 2000);
  const probeOrderId = probe.result.orderId;

  const pendingStatus = await request(`/api/payments/sepay?code=${paymentCode}`);
  assert.equal(pendingStatus.status, 200);
  assert.equal((await pendingStatus.json()).payment.status, "pending");

  const unsigned = await request("/api/webhooks/sepay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1001 }),
  });
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).success, false);

  const partialPayload = {
    id: 1001,
    gateway: "TPBank",
    transactionDate: "2026-08-15 10:00:00",
    accountNumber: "88888888188",
    subAccount: "",
    code: paymentCode,
    content: `${paymentCode} thanh toan don test`,
    transferType: "in",
    description: "KHACH TEST chuyen tien",
    transferAmount: 20000,
    accumulated: 20000,
    referenceCode: "FT-TEST-1001",
  };
  const partialResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", partialPayload), runtimeEnv, executionContext);
  assert.equal(partialResponse.status, 200);
  assert.deepEqual(await partialResponse.json(), { success: true });
  const partialStatus = await (await request(`/api/payments/sepay?code=${paymentCode}`)).json();
  assert.equal(partialStatus.payment.status, "partially_paid");
  assert.equal(partialStatus.payment.receivedAmount, 20000);

  const duplicateResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", partialPayload), runtimeEnv, executionContext);
  assert.equal(duplicateResponse.status, 200);
  const afterDuplicate = await (await request(`/api/payments/sepay?code=${paymentCode}`)).json();
  assert.equal(afterDuplicate.payment.receivedAmount, 20000);

  const completionPayload = {
    ...partialPayload,
    id: 1002,
    transactionDate: "2026-08-15 10:01:00",
    transferAmount: 51000,
    accumulated: 71000,
    referenceCode: "FT-TEST-1002",
  };
  const completionResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", completionPayload), runtimeEnv, executionContext);
  assert.equal(completionResponse.status, 200);
  const paidStatus = await (await request(`/api/payments/sepay?code=${paymentCode}`)).json();
  assert.equal(paidStatus.payment.status, "paid");
  assert.equal(paidStatus.payment.receivedAmount, 71000);
  assert.ok(paidStatus.payment.paidAt);

  const wrongAccountPayload = { ...partialPayload, id: 1003, accountNumber: "00000000000", transferAmount: 71000 };
  const wrongAccountResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", wrongAccountPayload), runtimeEnv, executionContext);
  assert.equal(wrongAccountResponse.status, 200);

  const order = (await database.get("SELECT * FROM operation_orders WHERE id = ?", primaryOrderId));
  assert.equal(order.customer_email, "test@example.com");
  assert.equal(order.currency, "VND");
  assert.equal(order.subtotal_amount, 56000);
  assert.equal(order.delivery_fee_amount, 15000);
  assert.equal(order.discount_amount, 0);
  assert.equal(order.total_amount, 71000);
  assert.equal(order.payment_method, "bank_transfer");
  assert.equal(order.payment_provider, "sepay");
  assert.equal(order.payment_status, "paid");
  assert.equal(order.kitchen_status, "queued");
  assert.equal(order.is_test, 1);
  assert.equal(order.source_environment, "test");
  assert.equal((await database.get("SELECT status FROM finance_order_allocations WHERE order_id = ?", primaryOrderId)).status, "posted");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM finance_ledger_entries WHERE order_id = ? AND status = 'pending'", primaryOrderId)).count, 0);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM payment_transactions WHERE provider = 'sepay' AND provider_transaction_id IN ('1001', '1002')")).count, 2);
  assert.equal((await database.get("SELECT match_status FROM payment_transactions WHERE provider_transaction_id = '1003'")).match_status, "wrong_account");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_event_log WHERE action = 'payment.received' AND entity_id = ?", primaryOrderId)).count, 2);

  const [managerCookie, financeCookie] = await Promise.all([
    portalCookie(request, "store-owner"),
    portalCookie(request, "accountant"),
  ]);
  const blockedCancellation = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: managerCookie },
    body: JSON.stringify({ command: "order.advance", data: { orderId: primaryOrderId, nextStatus: "cancelled", reason: "Khách yêu cầu hủy" } }),
  });
  assert.equal(blockedCancellation.status, 409);
  assert.equal((await blockedCancellation.json()).code, "refund_required");

  const unauthorizedRefund = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: managerCookie },
    body: JSON.stringify({ command: "payment.refund", data: { orderId: primaryOrderId, amount: 71000, reason: "Khách yêu cầu hủy", providerReference: "RF-BANK-1002" } }),
  });
  assert.equal(unauthorizedRefund.status, 403);
  assert.equal((await unauthorizedRefund.json()).code, "forbidden_role");

  const partialRefund = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: financeCookie },
    body: JSON.stringify({ command: "payment.refund", data: { orderId: primaryOrderId, amount: 20000, reason: "Khách yêu cầu hủy", providerReference: "RF-BANK-PARTIAL" } }),
  });
  assert.equal(partialRefund.status, 200);
  const partialRefundResult = await partialRefund.json();
  assert.equal(partialRefundResult.result.refundType, "partial");
  assert.equal(partialRefundResult.result.paymentStatus, "partially_refunded");
  assert.equal(partialRefundResult.result.orderStatus, "new");
  assert.equal(partialRefundResult.result.refundableRemaining, 51000);

  const refundPayload = { command: "payment.refund", data: { orderId: primaryOrderId, amount: 51000, reason: "Khách yêu cầu hủy trước khi làm món", providerReference: "RF-BANK-1002" } };
  const refundResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: financeCookie },
    body: JSON.stringify(refundPayload),
  });
  assert.equal(refundResponse.status, 200);
  const refund = await refundResponse.json();
  assert.equal(refund.result.paymentStatus, "refunded");
  assert.equal(refund.result.orderStatus, "cancelled");
  assert.equal(refund.result.duplicate, false);

  const duplicateRefundResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: financeCookie },
    body: JSON.stringify(refundPayload),
  });
  assert.equal(duplicateRefundResponse.status, 200);
  assert.equal((await duplicateRefundResponse.json()).result.duplicate, true);

  const refundedOrder = (await database.get("SELECT order_status, payment_status, kitchen_status, delivery_status FROM operation_orders WHERE id = ?", primaryOrderId));
  assert.equal(refundedOrder.order_status, "cancelled");
  assert.equal(refundedOrder.payment_status, "refunded");
  assert.equal(refundedOrder.kitchen_status, "cancelled");
  assert.equal(refundedOrder.delivery_status, "cancelled");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM payment_refunds WHERE order_id = ? AND status = 'completed'", primaryOrderId)).count, 2);
  assert.equal((await database.get("SELECT status FROM payment_attempts WHERE order_id = ?", primaryOrderId)).status, "refunded");
  assert.equal((await database.get("SELECT status FROM finance_order_allocations WHERE order_id = ?", primaryOrderId)).status, "voided");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM finance_ledger_entries WHERE order_id = ? AND entry_type != 'customer_refund' AND status != 'voided'", primaryOrderId)).count, 0);
  assert.equal((await database.get("SELECT SUM(amount) AS amount FROM finance_ledger_entries WHERE order_id = ? AND entry_type = 'customer_refund' AND status = 'posted'", primaryOrderId)).amount, 71000);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_event_log WHERE entity_id = ? AND action = 'payment.refund'", primaryOrderId)).count, 2);

  const abandonedResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        orderId: "SEPAY-ABANDONED-001",
        orderCode: "SEPAY-ABANDONED-001",
        customerName: "Khách đóng trang thanh toán",
        deliveryAddress: "Mỹ Đình, Hà Nội",
        paymentMethod: "bank_transfer",
        siteId: "site-my-dinh",
        items: [{ productCode: "DC-BUOI", quantity: 1 }],
      },
    }),
  });
  assert.equal(abandonedResponse.status, 201);
  const abandoned = await abandonedResponse.json();
  const abandonedOrderId = abandoned.result.orderId;
  await database.run("UPDATE payment_attempts SET expires_at = ? WHERE payment_code = ?", new Date(Date.now() - 60_000).toISOString(), abandoned.result.payment.paymentCode);
  const sweepResponse = await request("/api/health");
  assert.equal(sweepResponse.status, 200);
  const sweepHealth = await sweepResponse.json();
  assert.ok(sweepHealth.checks.paymentExpiry.expired >= 1);
  assert.equal((await database.get("SELECT status FROM payment_attempts WHERE order_id = ?", abandonedOrderId)).status, "expired");
  const abandonedOrder = (await database.get("SELECT order_status, payment_status, kitchen_status FROM operation_orders WHERE id = ?", abandonedOrderId));
  assert.equal(abandonedOrder.order_status, "cancelled");
  assert.equal(abandonedOrder.payment_status, "expired");
  assert.equal(abandonedOrder.kitchen_status, "cancelled");
  assert.equal((await database.get("SELECT status FROM finance_order_allocations WHERE order_id = ?", abandonedOrderId)).status, "voided");

  const probeExpiry = new Date(Date.now() - 60_000).toISOString();
  await database.run("UPDATE payment_attempts SET expires_at = ? WHERE payment_code = ?", probeExpiry, probe.result.payment.paymentCode);
  const expiredProbe = await (await request(`/api/payments/sepay?code=${probe.result.payment.paymentCode}`)).json();
  assert.equal(expiredProbe.payment.status, "expired");
  const latePayment = {
    ...partialPayload,
    id: 1005,
    transactionDate: new Date().toISOString(),
    code: probe.result.payment.paymentCode,
    content: `${probe.result.payment.paymentCode} chuyen sau khi het han`,
    transferAmount: 2000,
    accumulated: 2000,
    referenceCode: "FT-TEST-1005",
  };
  const lateResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", latePayment), runtimeEnv, executionContext);
  assert.equal(lateResponse.status, 200);
  const afterLatePayment = await (await request(`/api/payments/sepay?code=${probe.result.payment.paymentCode}`)).json();
  assert.equal(afterLatePayment.payment.status, "expired");
  assert.equal(afterLatePayment.payment.receivedAmount, 0);
  const expiredOrder = (await database.get("SELECT order_status, payment_status, kitchen_status FROM operation_orders WHERE id = ?", probeOrderId));
  assert.equal(expiredOrder.order_status, "cancelled");
  assert.equal(expiredOrder.payment_status, "expired");
  assert.equal(expiredOrder.kitchen_status, "cancelled");
  assert.equal((await database.get("SELECT status FROM finance_order_allocations WHERE order_id = ?", probeOrderId)).status, "voided");
  assert.equal((await database.get("SELECT match_status FROM payment_transactions WHERE provider_transaction_id = '1005'")).match_status, "late_payment");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_alerts WHERE entity_id = ? AND category = 'payment' AND status = 'open'", probeOrderId)).count, 1);

  const delayedOnTimePayment = {
    ...latePayment,
    id: 1007,
    transactionDate: new Date(new Date(probeExpiry).getTime() - 1_000).toISOString(),
    content: `${probe.result.payment.paymentCode} giao dich dung han webhook den cham`,
    referenceCode: "FT-TEST-1007",
  };
  const delayedOnTimeResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", delayedOnTimePayment), runtimeEnv, executionContext);
  assert.equal(delayedOnTimeResponse.status, 200);
  assert.equal((await database.get("SELECT status, received_amount FROM payment_attempts WHERE payment_code = ?", probe.result.payment.paymentCode)).status, "expired");
  assert.equal((await database.get("SELECT status, received_amount FROM payment_attempts WHERE payment_code = ?", probe.result.payment.paymentCode)).received_amount, 0);
  assert.equal((await database.get("SELECT match_status FROM payment_transactions WHERE provider_transaction_id = '1007'")).match_status, "late_payment");
  assert.equal((await database.get("SELECT order_status FROM operation_orders WHERE id = ?", probeOrderId)).order_status, "cancelled");

  const invalidDateResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", { ...partialPayload, id: 1006, transactionDate: "not-a-date" }), runtimeEnv, executionContext);
  assert.equal(invalidDateResponse.status, 400);

  const expiredTimestampResponse = await worker.fetch(signedWebhook("/api/webhooks/sepay", { ...partialPayload, id: 1004 }, Math.floor(Date.now() / 1000) - 301), runtimeEnv, executionContext);
  assert.equal(expiredTimestampResponse.status, 401);

  process.env.ORDER_DATA_MODE = "live";
  const disabledProbeResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        orderId: "SEPAY-2K-PROBE-LIVE",
        customerName: "Probe must stay disabled in live mode",
        deliveryAddress: "Kiểm thử giới hạn chế độ live",
        fulfillmentType: "pickup",
        siteId: "site-my-dinh",
        items: [{ productCode: "TEST-SEPAY-2K", quantity: 1 }],
      },
    }),
  });
  assert.equal(disabledProbeResponse.status, 403);
  assert.equal((await disabledProbeResponse.json()).code, "test_payment_disabled");
  process.env.ORDER_DATA_MODE = "test";
});

/*
 * ĐÃ GỠ: "production data schema migrates existing test orders…"
 *
 * Bài đó dựng một database SQLite theo schema cũ rồi kiểm việc nâng cấp, và
 * khẳng định schemaVersion === 18 — con số của ĐƯỜNG SQLITE, tách hẳn khỏi
 * migration PostgreSQL (đang ở 115). Nó chỉ kiểm đường chạy đang được gỡ bỏ.
 *
 * Ghi chú nghiệm thu GĐ1 (LƯU Ý 1) đã xác định: không tồn tại tệp SQLite dữ
 * liệu thật nào, dữ liệu cũ là mã nguồn bản demo. Nên không có gì để nâng cấp.
 *
 * Ý ĐỒ của bài vẫn được giữ: "vá dữ liệu không được xoá hay đổi nhãn đơn đã có"
 * nay do backfillExistingOrders đảm nhiệm, chạy trong seedDemoData trên
 * PostgreSQL và được order-lifecycle cùng delivery-operations kiểm chứng.
 */
