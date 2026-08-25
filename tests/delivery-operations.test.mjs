import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, createAccount, login, ownerCookie } from "./helpers/portal-login.mjs";

process.env.ORDER_DATA_MODE = "live";
process.env.SEPAY_BANK_ACCOUNT = "88888888188";
process.env.SEPAY_BANK_CODE = "TPBank";
process.env.SEPAY_PAYMENT_PREFIX = "DCHE";
process.env.SEPAY_WEBHOOK_AUTH_MODE = "hmac";
process.env.SEPAY_WEBHOOK_SECRET = "daoche-m9-test-sepay-secret-at-least-32-characters";
process.env.LALAMOVE_ENABLED = "false";

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const oneKilometer = "21.037600,105.778420";
const sixKilometers = "21.082560,105.778420";
const outsideRadius = "21.136500,105.778420";
const items = [{ productCode: "DC-BUOI", quantity: 1 }];

async function setup() {
  configureAuthEnvironment();
  const { database, directory } = await freshDatabase("m9", { seed: true });
  process.env.UPLOAD_DIR = path.join(directory, "uploads");
  process.env.DEMO_SEED = "true";
  const worker = await loadServer("delivery-operations-test");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const owner = await ownerCookie(request);
  await request("/api/catalog?siteId=site-my-dinh");
  const allDay = JSON.stringify(Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, [["00:00", "23:59"]]])));
  await database.run("UPDATE operation_sites SET opening_hours_json = ?, service_radius_m = 10000, capacity_per_hour = 100, status = 'open', accepts_orders = 1, latitude_e6 = 21028610, longitude_e6 = 105778420 WHERE id = 'site-my-dinh'", allDay);
  // INSERT OR REPLACE la cu phap rieng SQLite; PostgreSQL dung ON CONFLICT.
  await database.run(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status)
    VALUES ('m9-stock', 'site-my-dinh', 'DC-BUOI', 100, 0, 1, 'available')
    ON CONFLICT (id) DO UPDATE SET on_hand = excluded.on_hand, reserved = excluded.reserved,
      track_stock = excluded.track_stock, status = excluded.status`);
  const shipperAccount = await createAccount(request, { role: "shipper", fullName: "Shipper M9" });
  await database.run("UPDATE operation_staff SET user_id = ?, status = 'available' WHERE id = 'shipper-tuan'", shipperAccount.userId);
  const shipper = await login(request, { phone: shipperAccount.phone, password: shipperAccount.password, role: "shipper" });
  return { request, owner, shipper, database };
}

async function quote(request, coordinates, ip) {
  const response = await request("/api/deliveries/quote", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ siteId: "site-my-dinh", coordinates, address: "Nam Từ Liêm, Hà Nội", items }),
  });
  const payload = await response.json();
  return { response, payload };
}

async function createOrder(request, key, deliveryQuote, coordinates, customerName = "Khách M9", address = "Mỹ Đình 2, Nam Từ Liêm, Hà Nội") {
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key, "x-forwarded-for": `198.51.100.${key.length + 20}` },
    body: JSON.stringify({ command: "order.create", data: {
      customerName,
      customerPhone: "0900000099",
      deliveryAddress: address,
      deliveryCoordinates: coordinates,
      deliveryQuoteId: deliveryQuote.id,
      deliveryDistrict: "Nam Từ Liêm",
      siteId: "site-my-dinh",
      paymentMethod: "cash",
      fulfillmentType: "delivery",
      items,
    } }),
  });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  return payload.result;
}

async function command(request, cookie, commandName, data, expected = 200) {
  const response = await request("/api/operations", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ command: commandName, data }) });
  const payload = await response.json();
  assert.equal(response.status, expected, JSON.stringify(payload));
  return payload;
}

async function ready(request, owner, orderId) {
  for (const nextStatus of ["accepted", "preparing", "ready"]) await command(request, owner, "order.advance", { orderId, nextStatus });
}

test("M9 báo phí khóa vào đơn, POD, GPS, dọn dữ liệu và gom tuyến", async () => {
  const { request, owner, shipper, database } = await setup();

  const near = await quote(request, oneKilometer, "198.51.100.91");
  assert.equal(near.response.status, 201, JSON.stringify(near.payload));
  assert.equal(near.payload.quote.fee, 15_000);
  assert.ok(near.payload.quote.distanceMeters > 900 && near.payload.quote.distanceMeters < 1_100);

  const far = await quote(request, sixKilometers, "198.51.100.92");
  assert.equal(far.response.status, 201, JSON.stringify(far.payload));
  assert.equal(far.payload.quote.fee, 25_000);
  assert.ok(far.payload.quote.distanceMeters > 5_800 && far.payload.quote.distanceMeters < 6_200);

  const outside = await quote(request, outsideRadius, "198.51.100.93");
  assert.equal(outside.response.status, 409, JSON.stringify(outside.payload));
  assert.equal(outside.payload.code, "out_of_service_area");

  await command(request, owner, "delivery-fee-rule.upsert", { ruleId: "m9-new-near-fee", ruleType: "distance", minValue: 0, maxValue: 2999, fee: 99_000, freeOverAmount: null, priority: 100 });
  const podOrder = await createOrder(request, "m9-pod-order", near.payload.quote, oneKilometer, "Khách nhận OTP");
  assert.equal(podOrder.amounts.deliveryFee, 15_000, "phí đã báo phải được khóa dù bảng phí đổi trước lúc chốt");
  const locked = (await database.get("SELECT delivery_fee_amount, delivery_quote_id, delivery_distance_meters FROM operation_orders WHERE id = ?", podOrder.orderId));
  assert.equal(locked.delivery_fee_amount, 15_000);
  assert.equal(locked.delivery_quote_id, near.payload.quote.id);
  assert.ok(locked.delivery_distance_meters > 900);

  await ready(request, owner, podOrder.orderId);
  await command(request, owner, "order.assign", { orderId: podOrder.orderId, shipperId: "shipper-tuan" });
  let trackingResponse = await request(`/api/orders/track?order=${encodeURIComponent(podOrder.orderCode)}&token=${podOrder.trackingToken}`);
  let tracking = await trackingResponse.json();
  assert.equal(trackingResponse.status, 200, JSON.stringify(tracking));
  assert.match(tracking.tracking.deliveryOtp, /^\d{4}$/);
  const deliveryOtp = tracking.tracking.deliveryOtp;

  await command(request, shipper, "order.advance", { orderId: podOrder.orderId, nextStatus: "picked_up" });
  const locationResponse = await request("/api/shipper/location", { method: "POST", headers: { "content-type": "application/json", cookie: shipper }, body: JSON.stringify({ orderId: podOrder.orderId, latitudeE6: 21_036_000, longitudeE6: 105_779_000, accuracyM: 12 }) });
  const locationPayload = await locationResponse.json();
  assert.equal(locationResponse.status, 201, JSON.stringify(locationPayload));
  trackingResponse = await request(`/api/orders/track?order=${encodeURIComponent(podOrder.orderCode)}&token=${podOrder.trackingToken}`);
  tracking = await trackingResponse.json();
  assert.equal(tracking.tracking.shipperLocation.latitudeE6, 21_036_000);
  assert.equal(tracking.tracking.shipperLocation.accuracyM, 12);
  await command(request, shipper, "order.advance", { orderId: podOrder.orderId, nextStatus: "delivering" });
  await command(request, shipper, "order.advance", { orderId: podOrder.orderId, nextStatus: "delivered" }, 409);
  await command(request, shipper, "order.advance", { orderId: podOrder.orderId, nextStatus: "delivered", deliveryOtp: "9999" }, 409);
  await command(request, shipper, "order.advance", { orderId: podOrder.orderId, nextStatus: "delivered", deliveryOtp });

  const failedQuote = await quote(request, sixKilometers, "198.51.100.94");
  const failedOrder = await createOrder(request, "m9-failed-order", failedQuote.payload.quote, sixKilometers, "Khách giao thất bại");
  await ready(request, owner, failedOrder.orderId);
  await command(request, owner, "order.assign", { orderId: failedOrder.orderId, shipperId: "shipper-tuan" });
  const png = new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], "failure.png", { type: "image/png" });
  const form = new FormData();
  form.set("orderId", failedOrder.orderId);
  form.set("purpose", "delivery_failed");
  form.set("file", png);
  const proofResponse = await request("/api/deliveries/proof", { method: "POST", headers: { cookie: shipper }, body: form });
  const proofPayload = await proofResponse.json();
  assert.equal(proofResponse.status, 201, JSON.stringify(proofPayload));
  await command(request, shipper, "order.advance", { orderId: failedOrder.orderId, nextStatus: "delivery_failed", reason: "Khách không nghe máy" });

  const routeOrders = [];
  for (let index = 0; index < 2; index += 1) {
    const routeQuote = await quote(request, sixKilometers, `198.51.100.${95 + index}`);
    const routeOrder = await createOrder(request, `m9-route-${index}`, routeQuote.payload.quote, sixKilometers, `Khách tuyến ${index + 1}`, `${index + 1} Phạm Hùng, Nam Từ Liêm, Hà Nội`);
    await ready(request, owner, routeOrder.orderId);
    routeOrders.push(routeOrder);
  }
  const routesResponse = await request("/api/deliveries/routes", { headers: { cookie: owner } });
  const routes = await routesResponse.json();
  assert.equal(routesResponse.status, 200, JSON.stringify(routes));
  const suggestion = routes.suggestions.find((entry) => routeOrders.every((order) => entry.orders.some((item) => item.id === order.orderId)));
  assert.ok(suggestion, `hai đơn cùng quận và cùng cửa sổ hẹn phải được gợi ý gom tuyến: ${JSON.stringify(routes)}`);
  await command(request, owner, "delivery.route.confirm", { orderIds: suggestion.orders.map((order) => order.id), shipperId: "shipper-tuan" });

  const old = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString();
  await database.run("UPDATE shipper_locations SET recorded_at = ? WHERE order_id = ?", old, podOrder.orderId);
  await database.run("UPDATE delivery_proofs SET captured_at = ? WHERE id = ?", old, proofPayload.proof.id);
  const healthResponse = await request("/api/health");
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200, JSON.stringify(health));
  assert.ok(health.checks.deliveryDataCleanup.removedLocations >= 1);
  assert.ok(health.checks.deliveryDataCleanup.expiredPhotos >= 1);
  assert.ok(health.checks.deliveryDataCleanup.deletedFiles >= 1);
  const expiredImageResponse = await request(proofPayload.proof.photoUrl, { headers: { cookie: shipper } });
  assert.equal(expiredImageResponse.status, 404);

  assert.equal((await database.get("SELECT COUNT(*) AS count FROM shipper_locations WHERE order_id = ?", podOrder.orderId)).count, 0);
  assert.equal((await database.get("SELECT photo_url FROM delivery_proofs WHERE id = ?", proofPayload.proof.id)).photo_url, "");
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_orders WHERE id IN (?, ?) AND order_status = 'assigned'", routeOrders[0].orderId, routeOrders[1].orderId)).count, 2);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM delivery_proofs WHERE order_id = ? AND proof_type = 'otp' AND otp_verified = 1", podOrder.orderId)).count, 1);
});
