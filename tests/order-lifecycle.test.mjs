import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, ownerCookie, portalCookie } from "./helpers/portal-login.mjs";

process.env.SEPAY_BANK_ACCOUNT = "88888888188";
process.env.SEPAY_BANK_CODE = "TPBank";
process.env.SEPAY_PAYMENT_PREFIX = "DCHE";
process.env.ORDER_DATA_MODE = "test";

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

async function setup() {
  configureAuthEnvironment();
  const { database } = await freshDatabase("m4", { seed: true });
  process.env.DEMO_SEED = "true";
  const worker = await loadServer("order-lifecycle-test");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const owner = await ownerCookie(request);
  await request("/api/catalog?siteId=site-my-dinh");
  const allDay = JSON.stringify(Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [["00:00", "23:59"]]])));
  await database.run("UPDATE operation_sites SET opening_hours_json = ?, capacity_per_hour = 20, status = 'open', accepts_orders = 1 WHERE id = 'site-my-dinh'", allDay);
  // INSERT OR REPLACE la cu phap rieng cua SQLite; PostgreSQL dung ON CONFLICT.
  await database.run(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status)
    VALUES ('m4-stock', 'site-my-dinh', 'DC-BUOI', 50, 0, 1, 'available')
    ON CONFLICT (id) DO UPDATE SET on_hand = excluded.on_hand, reserved = excluded.reserved,
      track_stock = excluded.track_stock, status = excluded.status`);
  return { request, owner, database };
}

function publicOrder(request, key, overrides = {}) {
  const base = {
    customerName: "Khách M4",
    customerPhone: "0900000044",
    deliveryAddress: "Mỹ Đình, Hà Nội",
    siteId: "site-my-dinh",
    paymentMethod: "cash",
    fulfillmentType: "delivery",
    items: [{ productCode: "DC-BUOI", quantity: 1 }],
  };
  return request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ command: "order.create", data: { ...base, ...overrides } }),
  });
}

async function command(request, cookie, commandName, data, expected = 200) {
  const response = await request("/api/operations", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ command: commandName, data }) });
  const payload = await response.json();
  assert.equal(response.status, expected, JSON.stringify(payload));
  return payload;
}

test("M4 idempotency, amend, dine-in, capacity, KDS và delivery_failed", async () => {
  const { request, owner, database } = await setup();

  const parallel = await Promise.all(Array.from({ length: 5 }, () => publicOrder(request, "m4-parallel-order-key")));
  const parallelBodies = await Promise.all(parallel.map((response) => response.json()));
  assert.ok(parallel.every((response) => response.status === 201));
  for (const body of parallelBodies.slice(1)) assert.deepEqual(body, parallelBodies[0]);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_orders WHERE id = ?", parallelBodies[0].result.orderId)).count, 1);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = 'order.create' AND key = 'm4-parallel-order-key'")).count, 1);

  const conflictResponse = await publicOrder(request, "m4-parallel-order-key", { customerName: "Nội dung khác" });
  const conflict = await conflictResponse.json();
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflict.code, "idempotency_key_conflict");

  const dineResponse = await publicOrder(request, "m4-dine-in-key", { fulfillmentType: "dine-in", deliveryAddress: undefined, tableLabel: "Bàn 06" });
  const dine = await dineResponse.json();
  assert.equal(dineResponse.status, 201, JSON.stringify(dine));
  assert.equal(dine.result.amounts.deliveryFee, 0);
  const dineRow = (await database.get("SELECT fulfillment_type, table_label, delivery_address FROM operation_orders WHERE id = ?", dine.result.orderId));
  assert.equal(dineRow.fulfillment_type, "dine-in");
  assert.equal(dineRow.table_label, "Bàn 06");
  assert.equal(dineRow.delivery_address, "");
  assert.equal((await database.get("SELECT fulfillment_type FROM order_fulfillment_details WHERE order_id = ?", dine.result.orderId)).fulfillment_type, "dine-in");

  const amendCreatedResponse = await publicOrder(request, "m4-amend-key", { paymentMethod: "cash", items: [{ productCode: "DC-BUOI", quantity: 1, optionCodes: ["DC-BUOI.TOPPING.1"] }] });
  const amendCreated = await amendCreatedResponse.json();
  assert.equal(amendCreatedResponse.status, 201, JSON.stringify(amendCreated));
  const amended = await command(request, owner, "order.amend", {
    orderId: amendCreated.result.orderId,
    reason: "Khách gọi thêm một phần",
    items: [{ productCode: "DC-BUOI", quantity: 2, optionCodes: ["DC-BUOI.TOPPING.1"] }],
  });
  assert.equal(amended.result.amountDelta, 33_000);
  assert.equal(amended.result.paymentAdjustment.direction, "collect");
  assert.equal((await database.get("SELECT total_amount FROM operation_orders WHERE id = ?", amendCreated.result.orderId)).total_amount, 81_000);
  assert.equal((await database.get("SELECT amount_delta FROM order_amendments WHERE order_id = ?", amendCreated.result.orderId)).amount_delta, 33_000);
  assert.equal((await database.get("SELECT amount FROM order_payment_adjustments WHERE order_id = ? AND direction = 'collect'", amendCreated.result.orderId)).amount, 33_000);
  assert.equal((await database.get("SELECT quantity FROM catalog_stock_reservations WHERE order_id = ? AND product_sku = 'DC-BUOI'", amendCreated.result.orderId)).quantity, 2);

  await database.run("UPDATE operation_sites SET capacity_per_hour = 2 WHERE id = 'site-my-dinh'");
  const scheduledAt = new Date(Date.now() + 24 * 60 * 60_000);
  scheduledAt.setUTCHours(3, 0, 0, 0);
  const firstScheduled = await publicOrder(request, "m4-capacity-first", { fulfillmentType: "pickup", scheduledFor: scheduledAt.toISOString(), promisedAt: scheduledAt.toISOString() });
  assert.equal(firstScheduled.status, 201, JSON.stringify(await firstScheduled.clone().json()));
  const overCapacityResponse = await publicOrder(request, "m4-capacity-over", { fulfillmentType: "pickup", scheduledFor: scheduledAt.toISOString(), promisedAt: scheduledAt.toISOString() });
  const overCapacity = await overCapacityResponse.json();
  assert.equal(overCapacityResponse.status, 409);
  assert.equal(overCapacity.code, "capacity_exceeded");
  assert.match(overCapacity.suggestedSlot, /^\d{4}-\d{2}-\d{2}T/);

  const kdsCreatedResponse = await publicOrder(request, "m4-kds-key", { fulfillmentType: "pickup" });
  const kdsCreated = await kdsCreatedResponse.json();
  await command(request, owner, "order.advance", { orderId: kdsCreated.result.orderId, nextStatus: "accepted" });
  const queueResponse = await request("/api/kitchen/queue?siteId=site-my-dinh", { headers: { cookie: owner } });
  const queue = await queueResponse.json();
  assert.equal(queueResponse.status, 200, JSON.stringify(queue));
  const queuedOrder = queue.orders.find((order) => order.orderId === kdsCreated.result.orderId);
  assert.equal(queuedOrder.items.length, 1);
  const itemId = queuedOrder.items[0].itemId;
  await command(request, owner, "order.item.start", { itemId });
  const done = await command(request, owner, "order.item.done", { itemId });
  assert.equal(done.result.readySuggested, true);

  const failedCreatedResponse = await publicOrder(request, "m4-delivery-failed-key");
  const failedCreated = await failedCreatedResponse.json();
  for (const nextStatus of ["accepted", "preparing", "ready"]) await command(request, owner, "order.advance", { orderId: failedCreated.result.orderId, nextStatus });
  const snapshot = await (await request("/api/operations", { headers: { cookie: owner } })).json();
  const shipper = snapshot.members.find((member) => member.roleId === "shipper" && member.state === "available");
  await command(request, owner, "order.assign", { orderId: failedCreated.result.orderId, shipperId: shipper.id });
  const storeOwner = await portalCookie(request, "store-owner", { siteIds: ["site-my-dinh"] });
  await command(request, storeOwner, "order.advance", { orderId: failedCreated.result.orderId, nextStatus: "delivery_failed", reason: "Khách từ chối nhận món" });
  assert.equal((await database.get("SELECT order_status FROM operation_orders WHERE id = ?", failedCreated.result.orderId)).order_status, "delivery_failed");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_alerts WHERE entity_id = ? AND category = 'delivery-failed'", failedCreated.result.orderId)).count, 1);
  assert.equal((await database.get("SELECT status FROM catalog_stock_reservations WHERE order_id = ?", failedCreated.result.orderId)).status, "active", "giao thất bại không được tự trả tồn");
});
