import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { portalCookie, configureAuthEnvironment } from "./helpers/portal-login.mjs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.SEPAY_BANK_ACCOUNT = "88888888188";
process.env.SEPAY_BANK_CODE = "TPBank";
process.env.SEPAY_PAYMENT_PREFIX = "TPHO";
process.env.ORDER_DATA_MODE = "test";

async function loadWorker() {
  return loadServer("operations-test");
}


/**
 * Mỗi test dùng một file SQLite riêng trong thư mục tạm.
 *
 * Trước M0 các test này chạy trên memory fallback. Đường chạy đó đã bị gỡ vì nó
 * là bản cài đặt thứ hai của toàn bộ 16 lệnh nghiệp vụ và chắc chắn sẽ lệch dần
 * so với bản thật. SQLite giữ nguyên hành vi mà không nhân đôi logic.
 */
let activeDatabase;
/**
 * Cấp cho mỗi bài test một PostgreSQL trắng, schema lấy từ drizzle/ như production.
 * Bài trước được đóng lại trước khi mở bài sau, để dữ liệu không rò rỉ sang nhau.
 */
async function useTemporaryDatabase(tag) {
  if (activeDatabase) await activeDatabase.cleanup();
  activeDatabase = await freshDatabase(tag, { seed: true });
  return activeDatabase.database;
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

const runtimeEnv = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

test("operations API seeds a usable snapshot and persists demo commands on PostgreSQL", async () => {
  configureAuthEnvironment();
  await useTemporaryDatabase("operations-api");
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const [superAdminCookie, kitchenCookie, storeCookie] = await Promise.all([
    portalCookie(request, "owner"),
    portalCookie(request, "kitchen"),
    portalCookie(request, "store-staff"),
  ]);

  const initialResponse = await request("/api/operations?role=shipper", { headers: { cookie: superAdminCookie } });
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  // Chạy trên PostgreSQL như production, không còn trên SQLite.
  assert.equal(initial.mode, "postgres");
  assert.equal(initial.meta.durable, true);
  assert.ok(initial.orders.length >= 5);
  assert.ok(initial.inventory.length >= 5);
  assert.ok(initial.members.some((member) => member.roleId === "shipper"));
  assert.ok(initial.locations.length >= 4);
  assert.ok(initial.alerts.length >= 3);
  assert.ok(initial.partners.length >= 3);
  assert.ok(initial.events.length >= 3);
  assert.equal(initial.finance.policy.workshopCostBps, 2000);
  assert.equal(initial.finance.policy.landedPartnerBps, 4000);
  assert.equal(initial.finance.policy.channelPoolBps, 6000);
  assert.ok(initial.finance.summary.ecosystemGmv > 0);
  assert.ok(initial.finance.orderEconomics.every((row) => row.workshopCost + row.partnerLogistics === row.landedPartner));
  assert.ok(initial.finance.orderEconomics.every((row) => row.landedPartner + row.channelPool === row.grossRevenue));
  assert.ok(initial.finance.productEconomics.length >= 3);

  const catalogResponse = await request("/api/catalog?siteId=site-my-dinh");
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.ok, true);
  assert.equal(catalog.currency, "VND");
  assert.ok(catalog.products.length >= 12);
  assert.equal(catalog.products.find((product) => product.sku === "TP-T2-S").price, 15000);
  assert.deepEqual(
    catalog.products.find((product) => product.sku === "TP-T2-S").options[0],
    { code: "TP-T2-S.TOPPING.1", kind: "topping", name: "Trân châu mini", priceDelta: 5000 },
  );

  const commandResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: kitchenCookie },
    body: JSON.stringify({
      command: "inventory.adjust",
      actor: { role: "kitchen", name: "Test bếp" },
      data: { inventoryId: "inv-jasmine-central", delta: 6, reason: "Nhập ca chiều" },
    }),
  });
  assert.equal(commandResponse.status, 200);
  const commandBody = await commandResponse.json();
  assert.equal(commandBody.ok, true);
  assert.equal(commandBody.result.onHand, 20);
  assert.equal(commandBody.snapshot.inventory.find((item) => item.id === "inv-jasmine-central").quantity, 20);
  assert.equal(commandBody.snapshot.events[0].action, "inventory.adjust");

  const createResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      actor: { role: "store", name: "Test quầy" },
      data: {
        customerName: "Khách demo API",
        customerPhone: "0900000088",
        deliveryAddress: "Tầng 22 Keangnam, Hà Nội",
        siteId: "site-keangnam",
        paymentStatus: "paid",
        affiliateCode: "HA88",
        affiliateBps: 800,
        items: [{ productCode: "TP-HN", productName: "Tên giả từ client", quantity: 2, unitPrice: 1 }],
      },
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.ok, true);
  assert.equal("snapshot" in created, false, "public order creation must not return an operations snapshot");
  assert.equal(created.result.amounts.total, 45000);
  assert.equal(created.result.amounts.deliveryFee, 15000);
  assert.match(created.result.payment.paymentCode, /^TPHO[A-F0-9]{12}$/);
  assert.equal(created.result.payment.bankAccount, "88888888188");

  const customizedResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách chọn topping",
        customerPhone: "0900000087",
        deliveryAddress: "Mỹ Đình, Hà Nội",
        siteId: "site-my-dinh",
        paymentMethod: "cash",
        items: [{ productCode: "TP-T2-S", quantity: 2, unitPrice: 1, optionCodes: ["TP-T2-S.TOPPING.1"], sweetness: "30%", temperature: "Lạnh" }],
      },
    }),
  });
  assert.equal(customizedResponse.status, 201);
  const customized = await customizedResponse.json();
  assert.equal(customized.result.amounts.subtotal, 40000, "backend must calculate base price plus topping and ignore client price");
  assert.equal(customized.result.amounts.total, 55000);

  const invalidOptionResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "order.create", data: { customerName: "Khách topping sai", deliveryAddress: "Mỹ Đình, Hà Nội", siteId: "site-my-dinh", items: [{ productCode: "TP-T2-S", quantity: 1, optionCodes: ["CH-KB.TOPPING.1"] }] } }),
  });
  assert.equal(invalidOptionResponse.status, 400);
  assert.equal((await invalidOptionResponse.json()).code, "invalid_product_option");

  const partnerOrderResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách điểm đối tác",
        customerPhone: "0900000090",
        deliveryAddress: "Cầu Giấy, Hà Nội",
        siteId: "site-cau-giay",
        partnerId: "partner-forged",
        items: [{ productCode: "TP-T2-S", quantity: 1 }],
      },
    }),
  });
  assert.equal(partnerOrderResponse.status, 201);
  const partnerOrder = await partnerOrderResponse.json();

  const kitchenOrderResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách chọn sai điểm",
        deliveryAddress: "Hà Nội",
        siteId: "site-central-kitchen",
        items: [{ productCode: "TP-T2-S", quantity: 1 }],
      },
    }),
  });
  assert.equal(kitchenOrderResponse.status, 409);
  assert.equal((await kitchenOrderResponse.json()).code, "site_not_orderable");

  const createdSnapshotResponse = await request("/api/operations", { headers: { cookie: superAdminCookie } });
  assert.equal(createdSnapshotResponse.status, 200);
  const createdSnapshot = await createdSnapshotResponse.json();
  const createdOrder = createdSnapshot.orders.find((order) => order.id === created.result.orderId);
  assert.equal(createdOrder.customerName, "Khách demo API");
  assert.equal(createdOrder.status, "new");
  assert.equal(createdOrder.total, 45000);
  assert.equal(createdOrder.paymentMethod, "bank_transfer");
  assert.equal(createdOrder.isTest, true);
  assert.equal(createdSnapshot.finance.orderEconomics.find((row) => row.orderId === partnerOrder.result.orderId).partnerId, "partner-moc-coffee");
  const economics = createdSnapshot.finance.orderEconomics.find((row) => row.orderId === created.result.orderId);
  assert.equal(economics.workshopCost, 9000);
  assert.equal(economics.partnerLogistics, 9000);
  assert.equal(economics.landedPartner, 18000);
  assert.equal(economics.channelPool, 27000);
  assert.equal(economics.affiliateCommission, 3600);
  assert.equal(economics.channelContribution, 23400);

  const unknownProductResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách sản phẩm sai",
        customerPhone: "0900000089",
        deliveryAddress: "Hà Nội",
        siteId: "site-my-dinh",
        items: [{ productCode: "TP-NOT-REAL", quantity: 1, unitPrice: 1 }],
      },
    }),
  });
  assert.equal(unknownProductResponse.status, 400);
  assert.equal((await unknownProductResponse.json()).code, "invalid_product");

  const wrongContentTypeResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ command: "order.create" }),
  });
  assert.equal(wrongContentTypeResponse.status, 415);
  assert.equal((await wrongContentTypeResponse.json()).code, "unsupported_media_type");

  const repeatedClientReference = {
    command: "order.create",
    data: {
      orderId: "DR-45123",
      orderCode: "DR-45123",
      customerName: "Khách kiểm thử trùng mã",
      deliveryAddress: "Mỹ Đình, Hà Nội",
      siteId: "site-my-dinh",
      items: [{ productCode: "TP-T2-S", quantity: 1 }],
    },
  };
  const firstReferenceResponse = await request("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(repeatedClientReference) });
  const secondReferenceResponse = await request("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(repeatedClientReference) });
  assert.equal(firstReferenceResponse.status, 201);
  assert.equal(secondReferenceResponse.status, 409);
  const firstReferenceOrder = await firstReferenceResponse.json();
  const secondReferenceOrder = await secondReferenceResponse.json();
  assert.notEqual(firstReferenceOrder.result.orderId, "DR-45123");
  assert.equal(secondReferenceOrder.code, "duplicate_client_reference");
  assert.equal(secondReferenceOrder.error, "Đơn hàng này đã được ghi nhận.");
  assert.equal(secondReferenceOrder.existingOrderCode, firstReferenceOrder.result.orderCode);
  const deduplicatedSnapshotResponse = await request("/api/operations", { headers: { cookie: superAdminCookie } });
  assert.equal(deduplicatedSnapshotResponse.status, 200);
  const deduplicatedSnapshot = await deduplicatedSnapshotResponse.json();
  assert.equal(deduplicatedSnapshot.orders.filter((order) => order.customerName === "Khách kiểm thử trùng mã").length, 1);

  const tooManyItemsResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        customerName: "Khách gửi quá nhiều dòng",
        deliveryAddress: "Mỹ Đình, Hà Nội",
        siteId: "site-my-dinh",
        items: Array.from({ length: 51 }, () => ({ productCode: "TP-T2-S", quantity: 1 })),
      },
    }),
  });
  assert.equal(tooManyItemsResponse.status, 400);
  assert.equal((await tooManyItemsResponse.json()).code, "too_many_order_items");

  const pendingAffiliate = createdSnapshot.finance.ledger.find((row) => row.referenceId === created.result.orderCode && row.type === "affiliate_commission");
  assert.equal(pendingAffiliate.status, "pending");
  assert.equal(pendingAffiliate.direction, "out");

  const prematureSettlementResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: superAdminCookie },
    body: JSON.stringify({ command: "finance.settle", actor: { role: "super-admin", name: "Tài chính Test" }, data: { ledgerId: pendingAffiliate.id, note: "Đối soát thử" } }),
  });
  assert.equal(prematureSettlementResponse.status, 409);
  assert.equal((await prematureSettlementResponse.json()).code, "ledger_not_settleable");

  const earnedAffiliate = createdSnapshot.finance.ledger.find((row) => row.referenceId === "TP88-240799" && row.type === "affiliate_commission");
  assert.equal(earnedAffiliate.status, "pending", "the finance view groups earned commissions into the pending settlement queue");
  const settleResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: superAdminCookie },
    body: JSON.stringify({ command: "finance.settle", actor: { role: "super-admin", name: "Tài chính Test" }, data: { ledgerId: earnedAffiliate.id, note: "Đối soát thử" } }),
  });
  assert.equal(settleResponse.status, 200);
  const settled = await settleResponse.json();
  assert.equal(settled.result.status, "paid");
  assert.equal(settled.snapshot.finance.ledger.find((row) => row.id === earnedAffiliate.id).status, "settled");
  assert.ok(settled.snapshot.finance.settlements.some((row) => row.id === settled.result.settlementId && row.status === "paid"));

  const expenseResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: storeCookie },
    body: JSON.stringify({
      command: "expense.create",
      actor: { role: "store", name: "Quản lý Mỹ Đình" },
      data: { locationId: "site-my-dinh", locationName: "Tào Phớ 88 Mỹ Đình", category: "utilities", description: "Mua bổ sung đá sạch", amount: 125000, occurredAt: "2026-08-01", receiptReference: "HD-TEST-001", submittedBy: "Quản lý Mỹ Đình" },
    }),
  });
  assert.equal(expenseResponse.status, 200);
  const expenseCreated = await expenseResponse.json();
  assert.equal(expenseCreated.result.status, "pending");
  assert.equal(expenseCreated.snapshot.finance.expenses.length, 0, "store snapshots must not expose the finance ledger");

  const approveResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: superAdminCookie },
    body: JSON.stringify({ command: "expense.approve", actor: { role: "super-admin", name: "Super Admin Test" }, data: { expenseId: expenseCreated.result.expenseId, decision: "approve", reason: "Đã đối chiếu" } }),
  });
  assert.equal(approveResponse.status, 200);
  const approved = await approveResponse.json();
  assert.equal(approved.result.status, "approved");
  assert.equal(approved.snapshot.finance.expenses.find((row) => row.id === expenseCreated.result.expenseId).receiptUrl, "HD-TEST-001");
  assert.equal(approved.snapshot.finance.expenses.find((row) => row.id === expenseCreated.result.expenseId).status, "approved");
  assert.ok(approved.snapshot.finance.ledger.some((row) => row.referenceId === expenseCreated.result.expenseCode && row.type === "operating_expense"));
});

test("finance commands reject invalid money and invalid price waterfalls", async () => {
  configureAuthEnvironment();
  await useTemporaryDatabase("operations-api");
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const [storeCookie, superAdminCookie] = await Promise.all([
    portalCookie(request, "store-staff"),
    portalCookie(request, "owner"),
  ]);
  const invalidExpense = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: storeCookie },
    body: JSON.stringify({ command: "expense.create", actor: { role: "store", name: "Test" }, data: { locationId: "site-my-dinh", category: "utilities", description: "Sai số tiền", amount: -1, occurredAt: "2026-08-01" } }),
  });
  assert.equal(invalidExpense.status, 400);

  const invalidPolicy = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: superAdminCookie },
    body: JSON.stringify({ command: "finance.policy.update", actor: { role: "super-admin", name: "Test" }, data: { workshopCostBps: 2000, landedPartnerBps: 4000, channelPoolBps: 7000, defaultAffiliateBps: 800, effectiveFrom: "2026-08-01" } }),
  });
  assert.equal(invalidPolicy.status, 400);

  process.env.DEMO_SEED = "false";
  const disabledSeed = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: superAdminCookie },
    body: JSON.stringify({ command: "seed-demo", data: {} }),
  });
  assert.equal(disabledSeed.status, 403);
  assert.equal((await disabledSeed.json()).code, "demo_seed_disabled");
});

test("public order creation rate limits repeated automated requests", async () => {
  await useTemporaryDatabase("operations-api");
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const headers = { "content-type": "application/json", "x-forwarded-for": "198.51.100.212" };
  const body = JSON.stringify({
    command: "order.create",
    data: {
      customerName: "Kiểm thử giới hạn",
      deliveryAddress: "Mỹ Đình, Hà Nội",
      siteId: "site-my-dinh",
      items: [{ productCode: "TP-NOT-REAL", quantity: 1 }],
    },
  });
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await request("/api/operations", { method: "POST", headers, body });
    assert.equal(response.status, 400, `attempt ${attempt} should still reach validation`);
  }
  const blocked = await request("/api/operations", { method: "POST", headers, body });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "order_rate_limited");
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});
