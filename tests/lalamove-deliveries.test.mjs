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

function signature(secret, timestamp, method, pathname, body = "") {
  return createHmac("sha256", secret).update(`${timestamp}\r\n${method}\r\n${pathname}\r\n\r\n${body}`).digest("hex");
}

async function loadWorker(tag) {
  return loadServer(`lalamove-test-${tag}`);
}

test("Lalamove sandbox quote, booking and signed webhook are durable and idempotent", async () => {
  const { database } = await freshDatabase("lalamove", { seed: true });
  process.env.DEMO_SEED = "true";
  configureAuthEnvironment();
  process.env.SEPAY_BANK_ACCOUNT = "88888888188";
  process.env.SEPAY_BANK_CODE = "TPBank";
  process.env.SEPAY_PAYMENT_PREFIX = "TPHO";
  process.env.SEPAY_WEBHOOK_AUTH_MODE = "hmac";
  process.env.SEPAY_WEBHOOK_SECRET = "tp88-lalamove-test-sepay-secret-at-least-32-characters";
  process.env.ORDER_DATA_MODE = "test";
  process.env.LALAMOVE_ENABLED = "true";
  process.env.LALAMOVE_ENV = "sandbox";
  process.env.LALAMOVE_API_KEY = "pk_test_tp88";
  process.env.LALAMOVE_API_SECRET = "sk_test_tp88-secret";
  process.env.LALAMOVE_MARKET = "VN";
  process.env.LALAMOVE_AUTO_BOOK = "false";

  const worker = await loadWorker("flow");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const [superCookie, dispatchCookie] = await Promise.all([
    portalCookie(request, "owner"),
    portalCookie(request, "store-owner"),
  ]);

  const getProbe = await request("/api/webhooks/lalamove");
  assert.equal(getProbe.status, 200);
  assert.deepEqual(await getProbe.json(), { success: true });
  const headProbe = await request("/api/webhooks/lalamove", { method: "HEAD" });
  assert.equal(headProbe.status, 200);
  assert.equal(await headProbe.text(), "");
  const postProbe = await request("/api/webhooks/lalamove", { method: "POST" });
  assert.equal(postProbe.status, 200);
  assert.deepEqual(await postProbe.json(), { success: true });
  const unsignedWebhook = await request("/api/webhooks/lalamove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "ORDER_STATUS_CHANGED" }),
  });
  assert.equal(unsignedWebhook.status, 401);
  assert.equal((await unsignedWebhook.json()).code, "invalid_lalamove_authorization");

  const healthResponse = await request("/api/health");
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  // So voi requiredSchemaVersion thay vi so cung: con so nay doi moi lan them
  // migration, va dieu can khang dinh la "DB da chay het migration".
  assert.equal(health.checks.database.schemaVersion, health.checks.database.requiredSchemaVersion);
  assert.equal(health.checks.database.dataIntegrity.ok, true);
  assert.equal(health.checks.lalamove.ok, true);
  assert.equal(health.checks.lalamove.environment, "sandbox");

  const createdResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách test Lalamove",
        customerPhone: "0901234567",
        deliveryAddress: "50 Phạm Hùng, Nam Từ Liêm, Hà Nội",
        deliveryCoordinates: "21.020659, 105.780811",
        fulfillmentType: "delivery",
        siteId: "site-my-dinh",
        paymentMethod: "cash",
        items: [{ productCode: "TP-T2-S", quantity: 2 }],
      },
    }),
  });
  assert.equal(createdResponse.status, 201);
  const orderId = (await createdResponse.json()).result.orderId;

  for (const nextStatus of ["accepted", "preparing", "ready"]) {
    const advanced = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: superCookie },
      body: JSON.stringify({ command: "order.advance", data: { orderId, nextStatus } }),
    });
    assert.equal(advanced.status, 200);
  }

  const apiCalls = [];
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    apiCalls.push({ pathname: parsed.pathname, init });
    assert.equal(init.headers.market, "VN");
    const authorization = init.headers.authorization;
    const match = authorization.match(/^hmac ([^:]+):(\d+):([a-f0-9]{64})$/);
    assert.ok(match);
    assert.equal(match[1], process.env.LALAMOVE_API_KEY);
    assert.equal(match[3], signature(process.env.LALAMOVE_API_SECRET, match[2], init.method, parsed.pathname, init.body || ""));
    if (parsed.pathname === "/v3/quotations") {
      return Response.json({
        data: {
          quotationId: "1888888888888888001",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          serviceType: "MOTORCYCLE",
          stops: [
            { stopId: "stop-pickup", coordinates: { lat: "21.028610", lng: "105.778420" }, address: "Số 18 Nguyễn Hoàng" },
            { stopId: "stop-dropoff", coordinates: { lat: "21.020659", lng: "105.780811" }, address: "50 Phạm Hùng" },
          ],
          priceBreakdown: { total: "24500", currency: "VND" },
          distance: { value: "1800", unit: "m" },
        },
      });
    }
    if (parsed.pathname === "/v3/orders") {
      return Response.json({
        data: {
          orderId: "1999999999999999001",
          quotationId: "1888888888888888001",
          status: "ASSIGNING_DRIVER",
          shareLink: "https://share.sandbox.lalamove.com/tp88-test",
          priceBreakdown: { total: "24500", currency: "VND" },
        },
      }, { status: 201 });
    }
    return Response.json({ message: "unexpected test path" }, { status: 500 });
  };

  try {
    const quoteResponse = await request("/api/deliveries/lalamove", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: dispatchCookie },
      body: JSON.stringify({ action: "quote", orderId }),
    });
    const quotePayload = await quoteResponse.json();
    assert.equal(quoteResponse.status, 201, JSON.stringify(quotePayload));
    const quote = quotePayload.quote;
    assert.equal(quote.fee, 24500);
    assert.equal(quote.distanceMeters, 1800);

    const bookingResponse = await request("/api/deliveries/lalamove", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: dispatchCookie },
      body: JSON.stringify({ action: "book", orderId, quoteId: quote.id }),
    });
    assert.equal(bookingResponse.status, 201);
    const booking = await bookingResponse.json();
    assert.equal(booking.duplicate, false);
    assert.equal(booking.job.providerOrderId, "1999999999999999001");
    assert.equal(booking.job.status, "assigning");

    const duplicateBookingResponse = await request("/api/deliveries/lalamove", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: dispatchCookie },
      body: JSON.stringify({ action: "book", orderId, quoteId: quote.id }),
    });
    assert.equal(duplicateBookingResponse.status, 201);
    assert.equal((await duplicateBookingResponse.json()).duplicate, true);
    assert.equal(apiCalls.filter((call) => call.pathname === "/v3/orders").length, 1);
  } finally {
    globalThis.fetch = nativeFetch;
  }

  const webhookData = {
    order: { orderId: "1999999999999999001", status: "COMPLETED", shareLink: "https://share.sandbox.lalamove.com/tp88-test" },
    updatedAt: new Date().toISOString(),
  };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const webhookPayload = {
    apiKey: process.env.LALAMOVE_API_KEY,
    timestamp: Number(timestamp),
    signature: signature(process.env.LALAMOVE_API_SECRET, timestamp, "POST", "/api/webhooks/lalamove", JSON.stringify(webhookData)),
    eventId: "sandbox-event-completed-1",
    eventType: "ORDER_STATUS_CHANGED",
    eventVersion: "v3",
    data: webhookData,
  };
  const webhookBody = JSON.stringify(webhookPayload);
  const webhookInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: webhookBody,
  };
  const webhookResponse = await request("/api/webhooks/lalamove", webhookInit);
  const webhookResult = await webhookResponse.json();
  assert.equal(webhookResponse.status, 200, JSON.stringify(webhookResult));
  assert.equal(webhookResult.duplicate, false);
  const duplicateWebhookResponse = await request("/api/webhooks/lalamove", webhookInit);
  assert.equal(duplicateWebhookResponse.status, 200);
  assert.equal((await duplicateWebhookResponse.json()).duplicate, true);

  const tamperedWebhookResponse = await request("/api/webhooks/lalamove", {
    ...webhookInit,
    body: JSON.stringify({
      ...webhookPayload,
      data: { ...webhookData, order: { ...webhookData.order, status: "CANCELED" } },
    }),
  });
  assert.equal(tamperedWebhookResponse.status, 401);
  assert.equal((await tamperedWebhookResponse.json()).code, "invalid_lalamove_signature");

  const deliveryExpense = (await database.get("SELECT amount, status, vendor FROM finance_expenses WHERE category = 'delivery' AND id LIKE 'expense-delivery-%'"));
  assert.equal(deliveryExpense.amount, 24500);
  assert.equal(deliveryExpense.status, "approved");
  assert.equal(deliveryExpense.vendor, "Lalamove");
  assert.equal((await database.get("SELECT amount FROM finance_ledger_entries WHERE entry_type = 'external_delivery_expense'")).amount, 24500);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_alerts WHERE id LIKE 'alert-delivery-margin-%'")).count, 1);

  const deliveryResponse = await request(`/api/deliveries/lalamove?orderId=${encodeURIComponent(orderId)}`, { headers: { cookie: dispatchCookie } });
  assert.equal(deliveryResponse.status, 200);
  assert.equal((await deliveryResponse.json()).delivery.job.status, "completed");
  const operationsResponse = await request("/api/operations", { headers: { cookie: superCookie } });
  assert.equal(operationsResponse.status, 200);
  const operation = (await operationsResponse.json()).orders.find((entry) => entry.id === orderId);
  assert.equal(operation.status, "delivered");
  assert.equal(operation.paymentStatus, "paid");

  const autoOrderResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách test tự động",
        customerPhone: "0901234568",
        deliveryAddress: "50 Phạm Hùng, Nam Từ Liêm, Hà Nội",
        deliveryCoordinates: "21.020659, 105.780811",
        fulfillmentType: "delivery",
        siteId: "site-my-dinh",
        paymentMethod: "cash",
        items: [{ productCode: "TP-T2-S", quantity: 1 }],
      },
    }),
  });
  assert.equal(autoOrderResponse.status, 201);
  const autoOrderId = (await autoOrderResponse.json()).result.orderId;
  for (const nextStatus of ["accepted", "preparing"]) {
    const advanced = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: superCookie },
      body: JSON.stringify({ command: "order.advance", data: { orderId: autoOrderId, nextStatus } }),
    });
    assert.equal(advanced.status, 200);
  }
  process.env.LALAMOVE_AUTO_BOOK = "true";
  const autoCalls = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    autoCalls.push(pathname);
    if (pathname === "/v3/quotations") return Response.json({ data: {
      quotationId: "1888888888888888002",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      serviceType: "MOTORCYCLE",
      stops: [
        { stopId: "auto-pickup", coordinates: { lat: "21.028610", lng: "105.778420" }, address: "Số 18 Nguyễn Hoàng" },
        { stopId: "auto-dropoff", coordinates: { lat: "21.020659", lng: "105.780811" }, address: "50 Phạm Hùng" },
      ],
      priceBreakdown: { total: "25000", currency: "VND" },
      distance: { value: "1800", unit: "m" },
    } });
    if (pathname === "/v3/orders") return Response.json({ data: {
      orderId: "1999999999999999002",
      quotationId: "1888888888888888002",
      status: "ASSIGNING_DRIVER",
      priceBreakdown: { total: "25000", currency: "VND" },
    } }, { status: 201 });
    return Response.json({ message: "unexpected test path" }, { status: 500 });
  };
  try {
    const readyResponse = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: superCookie },
      body: JSON.stringify({ command: "order.advance", data: { orderId: autoOrderId, nextStatus: "ready" } }),
    });
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.result.externalDispatch.attempted, true);
    assert.equal(ready.result.externalDispatch.job.providerOrderId, "1999999999999999002");
    assert.deepEqual(autoCalls, ["/v3/quotations", "/v3/orders"]);
  } finally {
    globalThis.fetch = nativeFetch;
    process.env.LALAMOVE_AUTO_BOOK = "false";
  }

  await database.run("UPDATE delivery_jobs SET booked_at = ?, status = 'assigning' WHERE order_id = ?", new Date(Date.now() - 10 * 60_000).toISOString(), autoOrderId);
  const timeoutHealthResponse = await request("/api/health");
  assert.equal(timeoutHealthResponse.status, 200);
  const timeoutHealth = await timeoutHealthResponse.json();
  assert.equal(timeoutHealth.checks.deliveryWatch.checked, 1);
  assert.equal(timeoutHealth.checks.deliveryWatch.alerted, 1);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_alerts WHERE id LIKE 'alert-lalamove-timeout-%'")).count, 1);
});

test("production Lalamove credentials cannot be used while order data is test", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tp88-lalamove-guard-"));
  process.env.DEMO_SEED = "true";
  configureAuthEnvironment();
  process.env.SEPAY_BANK_ACCOUNT = "88888888188";
  process.env.SEPAY_WEBHOOK_AUTH_MODE = "hmac";
  process.env.SEPAY_WEBHOOK_SECRET = "tp88-lalamove-test-sepay-secret-at-least-32-characters";
  process.env.ORDER_DATA_MODE = "test";
  process.env.LALAMOVE_ENABLED = "true";
  process.env.LALAMOVE_ENV = "production";
  process.env.LALAMOVE_API_KEY = "pk_prod_tp88";
  process.env.LALAMOVE_API_SECRET = "sk_prod_tp88-secret";
  process.env.LALAMOVE_AUTO_BOOK = "true";
  const worker = await loadWorker("production-guard");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const health = await request("/api/health");
  assert.equal(health.status, 503);
  const body = await health.json();
  assert.equal(body.checks.lalamove.productionGuard, false);
  assert.equal(body.checks.lalamove.ok, false);
});
