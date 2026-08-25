import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadServer } from "./helpers/load-server.mjs";
import { freshDatabase } from "./helpers/database.mjs";
import { configureAuthEnvironment, ownerCookie } from "./helpers/portal-login.mjs";

let active;
async function temporaryDatabase() {
  if (active) await active.cleanup();
  active = await freshDatabase("catalog", { seed: true });
  process.env.UPLOAD_DIR = path.join(active.directory, "uploads");
  process.env.DEMO_SEED = "true";
  process.env.ORDER_DATA_MODE = "test";
  return active.database;
}

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

test("M3 quản trị catalog, giá theo điểm/loại điểm và giữ nguyên giá đơn cũ", async () => {
  configureAuthEnvironment();
  await temporaryDatabase();
  const worker = await loadServer("catalog-management-test");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const cookie = await ownerCookie(request);

  const command = async (body, expected = 200) => {
    const response = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  };

  const unauthenticated = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "catalog.price.set", data: { sku: "TP-T2-S", scopeType: "base", price: 16_000 } }),
  });
  assert.equal(unauthenticated.status, 401);

  await command({ command: "catalog.price.set", data: { sku: "TP-T2-S", scopeType: "site_kind", scopeValue: "official-store", price: 16_000, reason: "Giá cửa hàng chính thức" } });
  await command({ command: "catalog.price.set", data: { sku: "TP-T2-S", scopeType: "site_kind", scopeValue: "partner-counter", price: 17_000, reason: "Giá quầy đối tác" } });

  const [officialResponse, partnerResponse] = await Promise.all([
    request("/api/catalog?siteId=site-my-dinh&channel=webapp"),
    request("/api/catalog?siteId=site-cau-giay&channel=webapp"),
  ]);
  const official = await officialResponse.json();
  const partner = await partnerResponse.json();
  assert.equal(official.products.find((product) => product.sku === "TP-T2-S").price, 16_000);
  assert.match(official.products.find((product) => product.sku === "TP-T2-S").description, /đậu tương/i);
  assert.equal(partner.products.find((product) => product.sku === "TP-T2-S").price, 17_000);

  const imageForm = new FormData();
  imageForm.set("file", new File([new Uint8Array([137, 80, 78, 71])], "catalog.png", { type: "image/png" }));
  const imageUpload = await request("/api/catalog/images", { method: "POST", headers: { cookie }, body: imageForm });
  const uploadedImage = await imageUpload.json();
  assert.equal(imageUpload.status, 201, JSON.stringify(uploadedImage));
  assert.match(uploadedImage.url, /^\/api\/catalog\/images\?name=/);
  const imageRead = await request(uploadedImage.url);
  assert.equal(imageRead.status, 200);
  assert.equal(imageRead.headers.get("content-type"), "image/png");

  const orderResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách kiểm thử giá M3",
        customerPhone: "0900000033",
        deliveryAddress: "Mỹ Đình, Hà Nội",
        siteId: "site-my-dinh",
        paymentMethod: "cash",
        items: [{ productCode: "TP-T2-S", quantity: 1, unitPrice: 1 }],
      },
    }),
  });
  const order = await orderResponse.json();
  assert.equal(orderResponse.status, 201, JSON.stringify(order));
  assert.equal(order.result.amounts.subtotal, 16_000, "server phải bỏ qua giá giả từ client");

  await command({ command: "catalog.price.set", data: { sku: "TP-T2-S", scopeType: "site", scopeValue: "site-my-dinh", price: 18_000, reason: "Giá mới sau khi đã đặt" } });
  const oldItem = await active.database.get("SELECT base_unit_price FROM operation_order_items WHERE order_id = ?", order.result.orderId);
  assert.equal(Number(oldItem.base_unit_price), 16_000, "đổi giá catalog không được sửa giá snapshot của đơn cũ");

  await command({
    command: "catalog.product.create",
    data: {
      sku: "M3-TEST-PRODUCT",
      name: "Món kiểm thử M3",
      category: "Tào phớ",
      basePrice: 19_000,
      description: "Nội dung lấy từ database",
      ingredients: "Đậu nành",
      tags: ["mới"],
      nutrition: { calories: 120 },
      sweetness: ["30%", "50%"],
    },
  });
  await command({ command: "catalog.option.upsert", data: { sku: "M3-TEST-PRODUCT", code: "M3-TEST-PRODUCT.TOPPING.1", name: "Hạt sen", priceDelta: 6_000 } });
  const createdCatalog = await (await request("/api/catalog?siteId=site-my-dinh")).json();
  const createdProduct = createdCatalog.products.find((product) => product.sku === "M3-TEST-PRODUCT");
  assert.equal(createdProduct.description, "Nội dung lấy từ database");
  assert.equal(createdProduct.options[0].priceDelta, 6_000);

  const invalidPrice = await command({ command: "catalog.price.set", data: { sku: "TP-T2-S", scopeType: "base", price: -1 } }, 400);
  assert.equal(invalidPrice.code, "number_out_of_range");

  await command({ command: "catalog.option.archive", data: { code: "M3-TEST-PRODUCT.TOPPING.1" } });
  await command({ command: "catalog.product.archive", data: { sku: "M3-TEST-PRODUCT" } });
  const archivedCatalog = await (await request("/api/catalog?siteId=site-my-dinh")).json();
  assert.equal(archivedCatalog.products.some((product) => product.sku === "M3-TEST-PRODUCT"), false);
});
