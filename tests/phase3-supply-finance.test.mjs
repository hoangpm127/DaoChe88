import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, ownerCookie, portalCookie } from "./helpers/portal-login.mjs";

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

async function setup(name, demoSeed) {
  configureAuthEnvironment();
  const { database } = await freshDatabase(name, { seed: demoSeed });
  process.env.DEMO_SEED = demoSeed ? "true" : "false";
  process.env.ORDER_DATA_MODE = "test";
  process.env.SEPAY_BANK_ACCOUNT = "88888888188";
  process.env.SEPAY_BANK_CODE = "TPBank";
  process.env.SEPAY_PAYMENT_PREFIX = "DCHE";
  const worker = await loadServer(name);
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const owner = await ownerCookie(request);
  return { request, owner, database };
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

test("M7 mua hàng, sản xuất, FEFO, nhận thiếu, COGS thực, truy xuất và kiểm kê", async () => {
  const { request, owner, database } = await setup("phase3-m7", true);
  const expiresAt = new Date(Date.now() + 10 * 86_400_000).toISOString();

  const supplier = await command(request, owner, "supplier.upsert", { code: "NCC-M7", name: "Nhà cung cấp M7", paymentTermsDays: 15 });
  const purchase = await command(request, owner, "purchase.create", {
    supplierId: supplier.result.supplierId,
    siteId: "site-central-kitchen",
    poCode: "PO-M7-001",
    items: [{ materialSku: "NL-M7-DAU", materialName: "Đậu nành M7", unit: "kg", quantity: 100_000, unitCost: 10_000 }],
  });
  await command(request, owner, "purchase.receive", { purchaseOrderId: purchase.result.purchaseOrderId, items: [] });
  await command(request, owner, "recipe.upsert", { productSku: "DC-BUOI", materials: [{ materialSku: "NL-M7-DAU", quantityPerUnit: 500, unit: "kg" }] });
  const planned = await command(request, owner, "production.plan", { siteId: "site-central-kitchen", productSku: "DC-BUOI", batchCode: "LOT-M7-001", plannedQuantity: 200 });
  await command(request, owner, "production.start", { batchId: planned.result.batchId });
  const completed = await command(request, owner, "production.complete", { batchId: planned.result.batchId, producedQuantity: 200, rejectedQuantity: 0, laborCost: 100_000, overheadCost: 100_000, expiresAt, qualityNote: "Đạt QA M7" });
  assert.equal(completed.result.unitCost, 6_000);

  const transfer = await command(request, owner, "transfer.request", { fromSiteId: "site-central-kitchen", toSiteId: "site-my-dinh", transferCode: "DC-M7-001", items: [{ productSku: "DC-BUOI", quantity: 30 }] });
  await command(request, owner, "transfer.approve", { transferId: transfer.result.transferId });
  await command(request, owner, "transfer.pack", { transferId: transfer.result.transferId });
  await command(request, owner, "transfer.ship", { transferId: transfer.result.transferId, vehicle: "29A-M7", driverName: "Tài xế M7" });
  const transferItem = (await database.get("SELECT id, quantity_shipped FROM transfer_order_items WHERE transfer_id = ?", transfer.result.transferId));
  const storeOwner = await portalCookie(request, "store-owner", { siteIds: ["site-my-dinh"] });
  const received = await command(request, storeOwner, "transfer.receive", { transferId: transfer.result.transferId, items: [{ itemId: transferItem.id, quantityReceived: 28, quantityDamaged: 0, reason: "Thiếu 2 phần khi bàn giao" }] });
  assert.equal(received.result.status, "partially_received");
  assert.equal(received.result.receivedQuantity, 28);

  assert.equal((await database.get("SELECT quantity FROM site_stock_lots WHERE site_id = 'site-central-kitchen' AND batch_id = ?", planned.result.batchId)).quantity, 170);
  assert.equal((await database.get("SELECT quantity FROM site_stock_lots WHERE site_id = 'site-my-dinh' AND batch_id = ?", planned.result.batchId)).quantity, 28);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM transfer_discrepancies WHERE transfer_id = ? AND missing_quantity = 2", transfer.result.transferId)).count, 1);
  assert.equal((await database.get("SELECT balance FROM internal_accounts WHERE site_id = 'site-my-dinh'")).balance, received.result.debtIncrease);

  const orderResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "m7-real-cogs-order" },
    body: JSON.stringify({ command: "order.create", data: { customerName: "Khách COGS M7", customerPhone: "0900000707", deliveryAddress: "Mỹ Đình", fulfillmentType: "pickup", siteId: "site-my-dinh", paymentMethod: "bank_transfer", items: [{ productCode: "DC-BUOI", quantity: 1 }] } }),
  });
  const order = await orderResponse.json();
  assert.equal(orderResponse.status, 201, JSON.stringify(order));
  await database.run("UPDATE operation_orders SET payment_status = 'paid' WHERE id = ?", order.result.orderId);
  for (const nextStatus of ["accepted", "preparing", "ready", "delivered"]) await command(request, owner, "order.advance", { orderId: order.result.orderId, nextStatus });

  const allocation = (await database.get("SELECT workshop_cost, cost_source FROM finance_order_allocations WHERE order_id = ?", order.result.orderId));
  assert.equal(allocation.workshop_cost, 6_000, "COGS phải bằng unit_cost lô, không phải tỷ lệ giá bán");
  assert.equal(allocation.cost_source, "actual");
  assert.equal((await database.get("SELECT total_cost FROM order_item_lot_consumptions WHERE order_id = ?", order.result.orderId)).total_cost, 6_000);

  const traceResponse = await request(`/api/traceability?orderId=${encodeURIComponent(order.result.orderId)}`, { headers: { cookie: owner } });
  const trace = await traceResponse.json();
  assert.equal(traceResponse.status, 200, JSON.stringify(trace));
  assert.equal(trace.traceComplete, true);
  assert.equal(trace.consumptions[0].batchCode, "LOT-M7-001");
  assert.equal(trace.materialUsage[0].supplierCode, "NCC-M7");

  const count = await command(request, storeOwner, "stockcount.open", { siteId: "site-my-dinh", countType: "shift_close" });
  const countItem = (await database.get("SELECT product_sku, system_quantity FROM stock_count_items WHERE count_id = ? AND product_sku = 'DC-BUOI'", count.result.countId));
  await command(request, storeOwner, "stockcount.submit", { countId: count.result.countId, items: [{ productSku: countItem.product_sku, countedQuantity: countItem.system_quantity - 3, reason: "Thiếu ba phần cuối ca" }] });
  await command(request, storeOwner, "stockcount.approve", { countId: count.result.countId });
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM operation_alerts WHERE entity_id = ? AND category = 'stock-variance'", count.result.countId)).count, 1);
  assert.equal((await database.get("SELECT total_cost FROM waste_records WHERE reason = 'count_variance' AND site_id = 'site-my-dinh' ORDER BY created_at DESC LIMIT 1")).total_cost, 18_000);

  const expiredAt = new Date(Date.now() - 86_400_000).toISOString();
  // INSERT OR REPLACE la cu phap rieng SQLite; PostgreSQL dung ON CONFLICT.
  await database.run(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status)
    VALUES ('m7-expired-stock', 'site-keangnam', 'DC-BUOI', 5, 0, 1, 'available')
    ON CONFLICT (id) DO UPDATE SET on_hand = excluded.on_hand, reserved = excluded.reserved,
      track_stock = excluded.track_stock, status = excluded.status`);
  await database.run("INSERT INTO site_stock_lots (id, site_id, product_sku, batch_id, quantity, unit_cost, expires_at, received_at, status) VALUES ('m7-expired-lot', 'site-keangnam', 'DC-BUOI', NULL, 5, 6000, ?, ?, 'available')", expiredAt, expiredAt);
  const expiredOrder = await request("/api/operations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "m7-expired-order" }, body: JSON.stringify({ command: "order.create", data: { customerName: "Khách hết hạn", customerPhone: "0900000708", deliveryAddress: "Keangnam", fulfillmentType: "pickup", siteId: "site-keangnam", paymentMethod: "cash", items: [{ productCode: "DC-BUOI", quantity: 1 }] } }) });
  const expiredBody = await expiredOrder.json();
  assert.equal(expiredOrder.status, 409, JSON.stringify(expiredBody));
  assert.equal(expiredBody.code, "insufficient_fefo_stock");
  const expiredWaste = await command(request, owner, "waste.record", { siteId: "site-keangnam", productSku: "DC-BUOI", quantity: 5, reason: "expired", photoUrl: "https://example.invalid/evidence/m7-expired.jpg" });
  assert.equal(expiredWaste.result.totalCost, 30_000);
  assert.equal((await database.get("SELECT COUNT(*) AS count FROM waste_records WHERE site_id = 'site-keangnam' AND reason = 'expired'")).count, 1);
  assert.equal((await database.get("SELECT on_hand FROM catalog_site_stock WHERE site_id = 'site-keangnam' AND product_sku = 'DC-BUOI'")).on_hand, 0);

  const restrictedTransfer = await command(request, owner, "transfer.request", { fromSiteId: "site-central-kitchen", toSiteId: "site-my-dinh", transferCode: "DC-M7-SCOPE", items: [{ productSku: "DC-BUOI", quantity: 1 }] });
  const otherStoreStaff = await portalCookie(request, "store-staff", { siteIds: ["site-keangnam"] });
  const forbiddenReject = await command(request, otherStoreStaff, "transfer.reject", { transferId: restrictedTransfer.result.transferId, reason: "Không thuộc điểm được giao" }, 403);
  assert.equal(forbiddenReject.code, "entity_out_of_scope");
});

test("M10 báo cáo thật, RBAC, đối soát tự tính, hóa đơn deferred và khóa kỳ kép", async () => {
  const { request, owner, database } = await setup("phase3-m10", false);
  const empty = await (await request("/api/reports/finance/profit-loss", { headers: { cookie: owner } })).json();
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.sourceCount, 0);

  const now = new Date().toISOString();
  await database.run("INSERT INTO operation_sites (id, code, name, kind, address, district) VALUES ('site-m10-a', 'M10A', 'Cửa hàng M10 A', 'official-store', 'A', 'Hà Nội')");
  await database.run("INSERT INTO operation_sites (id, code, name, kind, address, district) VALUES ('site-m10-b', 'M10B', 'Cửa hàng M10 B', 'official-store', 'B', 'Hà Nội')");
  const INSERT_ORDER = `INSERT INTO operation_orders
    (id, order_code, customer_name, delivery_address, fulfillment_type, site_id, subtotal_amount, total_amount, item_count, payment_method, payment_status, source_environment, is_test, order_status, kitchen_status, delivery_status, promised_at, completed_at, created_at, updated_at)
    VALUES (?, ?, 'Khách M10', '', 'pickup', ?, ?, ?, 1, 'bank_transfer', 'paid', 'test', 1, 'delivered', 'completed', 'delivered', ?, ?, ?, ?)`;
  await await database.run(INSERT_ORDER, "order-m10-a", "M10-A", "site-m10-a", 100_000, 100_000, now, now, now, now);
  await await database.run(INSERT_ORDER, "order-m10-b", "M10-B", "site-m10-b", 200_000, 200_000, now, now, now, now);
  await database.run("INSERT INTO operation_order_items (id, order_id, product_code, product_name, quantity, base_unit_price, options_unit_price, unit_price, line_total) VALUES ('item-m10-a', 'order-m10-a', 'SKU-A', 'Món A', 1, 100000, 0, 100000, 100000)");
  await database.run("INSERT INTO operation_order_items (id, order_id, product_code, product_name, quantity, base_unit_price, options_unit_price, unit_price, line_total) VALUES ('item-m10-b', 'order-m10-b', 'SKU-B', 'Món B', 1, 200000, 0, 200000, 200000)");
  const INSERT_ALLOCATION = `INSERT INTO finance_order_allocations
    (id, order_id, policy_id, status, gross_revenue, workshop_cost, partner_logistics, landed_partner, channel_pool, affiliate_code, affiliate_bps, affiliate_commission, channel_contribution, cost_source, created_at, updated_at)
    VALUES (?, ?, 'policy-m10', 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await await database.run(INSERT_ALLOCATION, "allocation-m10-a", "order-m10-a", 100_000, 30_000, 10_000, 40_000, 60_000, "AFF-M10", 1000, 10_000, 50_000, "actual", now, now);
  await await database.run(INSERT_ALLOCATION, "allocation-m10-b", "order-m10-b", 200_000, 70_000, 20_000, 90_000, 120_000, null, 0, 0, 120_000, "estimated", now, now);
  await database.run("INSERT INTO finance_expenses (id, expense_code, site_id, category, description, amount, expense_date, status, submitted_by, created_at, updated_at) VALUES ('expense-m10-a', 'EXP-M10-A', 'site-m10-a', 'rent', 'Chi phí A', 5000, ?, 'approved', 'test', ?, ?)", now.slice(0, 10), now, now);
  await database.run("INSERT INTO finance_ledger_entries (id, occurred_at, entry_type, direction, amount, location_id, order_id, status, description, reference_code, created_at) VALUES ('ledger-aff-m10', ?, 'affiliate_commission', 'outflow', 10000, 'site-m10-a', 'order-m10-a', 'earned', 'Hoa hồng M10', 'M10-A', ?)", now, now);
  await database.run("INSERT INTO internal_accounts (id, site_id, balance, credit_limit, updated_at) VALUES ('account-m10-a', 'site-m10-a', 40000, 100000, ?)", now);
  await database.run("INSERT INTO internal_account_entries (id, site_id, entry_type, amount, balance_after, payment_reference, description, created_by, created_at) VALUES ('account-entry-m10-a', 'site-m10-a', 'adjustment', 40000, 40000, '', 'Số dư M10', 'test', ?)", now);
  await database.run("INSERT INTO finance_expenses (id, expense_code, site_id, category, description, amount, expense_date, status, submitted_by, created_at, updated_at) VALUES ('expense-m10-pending', 'EXP-M10-P', 'site-m10-a', 'other', 'Chờ duyệt', 7000, ?, 'pending', 'test', ?, ?)", now.slice(0, 10), now, now);

  const pnlResponse = await request("/api/reports/finance/profit-loss", { headers: { cookie: owner } });
  const pnl = await pnlResponse.json();
  assert.equal(pnlResponse.status, 200, JSON.stringify(pnl));
  assert.equal(pnl.rows.length, 2);
  const siteA = pnl.rows.find((row) => row.siteId === "site-m10-a");
  assert.equal(siteA.actualCogs, 30_000);
  assert.equal(siteA.profit, 45_000);
  const siteB = pnl.rows.find((row) => row.siteId === "site-m10-b");
  assert.equal(siteB.estimatedCogs, 70_000);
  const consolidated = await (await request("/api/reports/finance/consolidated-profit", { headers: { cookie: owner } })).json();
  assert.equal(consolidated.rows[0].profit, pnl.rows.reduce((sum, row) => sum + row.profit, 0));

  const storeOwner = await portalCookie(request, "store-owner", { siteIds: ["site-m10-a"] });
  const forbidden = await request("/api/reports/finance/profit-loss?siteId=site-m10-b", { headers: { cookie: storeOwner } });
  assert.equal(forbidden.status, 403);
  const scoped = await (await request("/api/reports/finance/profit-loss", { headers: { cookie: storeOwner } })).json();
  assert.deepEqual(scoped.rows.map((row) => row.siteId), ["site-m10-a"]);

  const debt = await (await request("/api/reports/finance/internal-debt", { headers: { cookie: owner } })).json();
  assert.equal(debt.rows[0].balance, 40_000);
  const csvResponse = await request("/api/reports/finance/revenue-period?format=csv", { headers: { cookie: owner } });
  assert.match(csvResponse.headers.get("content-type"), /text\/csv/);
  assert.match(await csvResponse.text(), /orderId,orderCode,siteId/);

  const invoice = await command(request, owner, "einvoice.defer", { orderId: "order-m10-a", buyerName: "Công ty M10", buyerTaxCode: "0101234567", buyerAddress: "Hà Nội", buyerEmail: "m10@example.com", vatRateBps: 800 });
  assert.equal(invoice.result.status, "deferred");
  assert.equal((await database.get("SELECT status FROM einvoices WHERE order_id = 'order-m10-a'")).status, "deferred");

  const manual = await command(request, owner, "finance.settle", { counterpartyType: "affiliate", counterpartyId: "AFF-M10", periodStart: "2020-01-01", periodEnd: "2030-01-01", grossAmount: 1 }, 400);
  assert.equal(manual.code, "manual_settlement_amount_forbidden");
  const settlement = await command(request, owner, "finance.settle", { counterpartyType: "affiliate", counterpartyId: "AFF-M10", periodStart: "2020-01-01", periodEnd: "2030-01-01", status: "draft" });
  assert.equal(settlement.result.grossAmount, 10_000);
  assert.equal(settlement.result.sourceCount, 1);

  const periodCode = now.slice(0, 7);
  await command(request, owner, "accounting-period.close", { periodCode, note: "Test khóa kỳ M10" });
  const blocked = await command(request, owner, "expense.approve", { expenseId: "expense-m10-pending", decision: "approved", status: "approved" }, 409);
  assert.equal(blocked.code, "accounting_period_closed");
  const blockedDebtPayment = await command(request, owner, "internal.payment", { siteId: "site-m10-a", amount: 1_000, paymentReference: "M10-CLOSED" }, 409);
  assert.equal(blockedDebtPayment.code, "accounting_period_closed");
  // Trigger chan ky da khoa o tang DB: tren PostgreSQL loi den dang Promise bi tu choi.
  await assert.rejects(database.run("INSERT INTO finance_ledger_entries (id, occurred_at, entry_type, direction, amount, status, description, created_at) VALUES ('ledger-after-close', ?, 'test', 'outflow', 1, 'posted', 'blocked', ?)", now, now), /accounting_period_closed/);
});
