import type { RuntimeDatabase, RuntimePreparedStatement } from "../db/runtime-database.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import { assertActor, operationEvent } from "./command-guards.ts";
import { eventStatement, queryRows } from "./operations-sql.ts";
import { actorCanAccessSite, allocateFefo, materialLots, productLots } from "./supply-chain-store.ts";
import { OperationsError, type JsonRecord } from "./operations-types.ts";
import type { CommandContext } from "./commands-orders.ts";
import { assertLedgerPeriodOpen } from "./commands-finance-compliance.ts";

type SiteRow = { id: string; kind: string; name: string };
type TransferRow = { id: string; transferCode: string; fromSiteId: string; toSiteId: string; status: string; transferValue: number; costValue: number; updatedAt: string };
type TransferItemRow = { id: string; transferId: string; productSku: string; quantityRequested: number; quantityShipped: number; quantityReceived: number; transferPrice: number; unitCost: number };
type ProductionBatchRow = { id: string; batchCode: string; siteId: string; productSku: string; plannedQuantity: number; status: string; updatedAt: string };

function objectItems(data: JsonRecord, key = "items") {
  const value = data[key];
  if (!Array.isArray(value) || !value.length || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new OperationsError(`Trường ${key} phải là danh sách không rỗng.`, 400, "invalid_items");
  }
  return value as JsonRecord[];
}

function actorId(context: CommandContext) {
  return context.actor.userId || context.actor.name;
}

function assertSiteAccess(context: CommandContext, siteId: string, action: string) {
  if (!actorCanAccessSite(context.actor, siteId)) throw new OperationsError(`Không được ${action} ngoài phạm vi điểm đã gán.`, 403, "entity_out_of_scope");
}

async function site(database: RuntimeDatabase, siteId: string) {
  const rows = await queryRows<SiteRow>(database.prepare("SELECT id, kind, name FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId));
  if (!rows[0]) throw new OperationsError("Không tìm thấy điểm vận hành.", 404, "site_not_found");
  return rows[0];
}

async function averageProductCost(database: RuntimeDatabase, siteId: string, sku: string, at: string) {
  const lots = await productLots(database, siteId, sku, at);
  const quantity = lots.reduce((sum, lot) => sum + Number(lot.quantity), 0);
  return quantity > 0 ? Math.round(lots.reduce((sum, lot) => sum + Number(lot.quantity) * Number(lot.unitCost), 0) / quantity) : 0;
}

async function transferPrice(database: RuntimeDatabase, productSku: string, siteKind: string, at: string) {
  const rows = await queryRows<{ transferPrice: number }>(database.prepare(`SELECT transfer_price FROM catalog_transfer_prices
    WHERE product_sku = ? AND site_kind = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
    ORDER BY effective_from DESC LIMIT 1`).bind(productSku, siteKind, at, at));
  if (rows[0]) return Number(rows[0].transferPrice);
  const product = await queryRows<{ basePrice: number }>(database.prepare("SELECT base_price FROM catalog_products WHERE sku = ? AND status = 'active' LIMIT 1").bind(productSku));
  if (!product[0]) throw new OperationsError(`Không tìm thấy SKU ${productSku}.`, 404, "catalog_product_not_found");
  return Number(product[0].basePrice);
}

export async function handleSupplyChainCommands(database: RuntimeDatabase, context: CommandContext) {
  const { command, actor, data, now } = context;
  const userId = actorId(context);

  if (command === "supplier.upsert") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "quản trị nhà cung cấp");
    const id = readString(data, "supplierId", false) || crypto.randomUUID();
    const code = boundedText(data, "code", 40).toLocaleUpperCase("en-US");
    const name = boundedText(data, "name", 160);
    await database.batch([
      database.prepare(`INSERT INTO suppliers
        (id, code, name, contact_name, phone, address, tax_code, payment_terms_days, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name, contact_name = excluded.contact_name,
          phone = excluded.phone, address = excluded.address, tax_code = excluded.tax_code,
          payment_terms_days = excluded.payment_terms_days, status = excluded.status, updated_at = excluded.updated_at`)
        .bind(id, code, name, boundedText(data, "contactName", 120, false), boundedText(data, "phone", 24, false), boundedText(data, "address", 300, false), boundedText(data, "taxCode", 30, false), readInteger(data, "paymentTermsDays", { min: 0, max: 365, required: false }), readString(data, "status", false) || "active", now, now),
      eventStatement(database, operationEvent("supplier", id, command, actor, null, "active", { code, name })),
    ]);
    return { command, supplierId: id, code };
  }

  if (command === "purchase.create") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "tạo đơn mua nguyên liệu");
    const siteId = readString(data, "siteId");
    const targetSite = await site(database, siteId);
    if (targetSite.kind !== "central-kitchen") throw new OperationsError("Đơn mua nguyên liệu phải nhập về bếp tổng.", 409, "purchase_site_not_kitchen");
    assertSiteAccess(context, siteId, "nhập nguyên liệu");
    const supplierId = readString(data, "supplierId");
    if (!await database.prepare("SELECT id FROM suppliers WHERE id = ? AND status = 'active'").bind(supplierId).first("id")) throw new OperationsError("Nhà cung cấp chưa hoạt động.", 409, "supplier_not_active");
    const items = objectItems(data);
    const parsed = items.map((item) => {
      const quantity = readInteger(item, "quantity", { min: 1, max: 1_000_000_000 });
      const unitCost = readInteger(item, "unitCost", { min: 0, max: 1_000_000_000 });
      return { id: crypto.randomUUID(), sku: boundedText(item, "materialSku", 80).toLocaleUpperCase("en-US"), name: boundedText(item, "materialName", 160), unit: boundedText(item, "unit", 30), quantity, unitCost, lineTotal: Math.round(quantity * unitCost / 1000) };
    });
    const subtotal = parsed.reduce((sum, item) => sum + item.lineTotal, 0);
    const vatAmount = readInteger(data, "vatAmount", { min: 0, max: 10_000_000_000, required: false });
    const id = crypto.randomUUID();
    const code = readString(data, "poCode", false) || `PO-${now.slice(2, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
    await database.batch([
      database.prepare(`INSERT INTO purchase_orders
        (id, po_code, supplier_id, site_id, status, ordered_at, expected_at, subtotal, vat_amount, total_amount,
         invoice_number, invoice_url, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ordered', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, code, supplierId, siteId, now, readString(data, "expectedAt", false) || null, subtotal, vatAmount, subtotal + vatAmount, boundedText(data, "invoiceNumber", 80, false), boundedText(data, "invoiceUrl", 500, false), userId, now, now),
      ...parsed.map((item) => database.prepare(`INSERT INTO purchase_order_items
        (id, po_id, material_sku, material_name, unit, quantity_ordered, quantity_received, unit_cost, line_total)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
        .bind(item.id, id, item.sku, item.name, item.unit, item.quantity, item.unitCost, item.lineTotal)),
      eventStatement(database, operationEvent("purchase-order", id, command, actor, null, "ordered", { code, subtotal, vatAmount })),
    ]);
    return { command, purchaseOrderId: id, poCode: code, totalAmount: subtotal + vatAmount };
  }

  if (command === "purchase.receive") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "nhận nguyên liệu");
    const purchaseOrderId = readString(data, "purchaseOrderId");
    const orders = await queryRows<{ id: string; siteId: string; supplierId: string; status: string; poCode: string; updatedAt: string }>(database.prepare("SELECT * FROM purchase_orders WHERE id = ? LIMIT 1").bind(purchaseOrderId));
    const order = orders[0];
    if (!order) throw new OperationsError("Không tìm thấy đơn mua.", 404, "purchase_order_not_found");
    if (!["ordered", "partially_received"].includes(order.status)) throw new OperationsError("Đơn mua không còn ở trạng thái nhận hàng.", 409, "purchase_order_not_receivable");
    assertSiteAccess(context, order.siteId, "nhận nguyên liệu");
    const rows = await queryRows<{ id: string; materialSku: string; materialName: string; unit: string; quantityOrdered: number; quantityReceived: number; unitCost: number }>(database.prepare("SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY id").bind(purchaseOrderId));
    const requested = Array.isArray(data.items) ? data.items as JsonRecord[] : [];
    const requestedById = new Map(requested.map((item) => [readString(item, "itemId"), item]));
    const statements: RuntimePreparedStatement[] = [];
    let allReceived = true;
    let receivedValue = 0;
    for (const row of rows) {
      const outstanding = Number(row.quantityOrdered) - Number(row.quantityReceived);
      const input = requestedById.get(row.id);
      const quantity = input ? readInteger(input, "quantity", { min: 0, max: outstanding }) : outstanding;
      if (quantity <= 0) {
        if (outstanding > 0) allReceived = false;
        continue;
      }
      const newReceived = Number(row.quantityReceived) + quantity;
      if (newReceived < Number(row.quantityOrdered)) allReceived = false;
      const lotId = crypto.randomUUID();
      const lotCode = input ? boundedText(input, "lotCode", 80, false) || `${order.poCode}-${row.materialSku}` : `${order.poCode}-${row.materialSku}`;
      const expiresAt = input && readString(input, "expiresAt", false) ? readIsoDate(input, "expiresAt") : null;
      const value = Math.round(quantity * Number(row.unitCost) / 1000);
      receivedValue += value;
      statements.push(
        database.prepare("UPDATE purchase_order_items SET quantity_received = ? WHERE id = ? AND quantity_received = ?").bind(newReceived, row.id, row.quantityReceived),
        database.prepare(`INSERT INTO material_stock_lots
          (id, site_id, material_sku, supplier_id, purchase_order_item_id, lot_code, quantity, unit_cost, expires_at, received_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`)
          .bind(lotId, order.siteId, row.materialSku, order.supplierId, row.id, lotCode, quantity, row.unitCost, expiresAt, now),
        database.prepare(`INSERT INTO operation_inventory (id, site_id, sku, name, unit, on_hand, reserved, reorder_level, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'healthy', ?)
          ON CONFLICT(site_id, sku) DO UPDATE SET on_hand = operation_inventory.on_hand + excluded.on_hand, updated_at = excluded.updated_at`)
          .bind(`inventory-${order.siteId}-${row.materialSku}`, order.siteId, row.materialSku, row.materialName, row.unit, quantity, now),
        database.prepare(`INSERT INTO material_stock_movements
          (id, site_id, material_sku, lot_id, movement_type, quantity, reference_type, reference_id, created_by, created_at)
          VALUES (?, ?, ?, ?, 'receive', ?, 'purchase-order', ?, ?, ?)`)
          .bind(crypto.randomUUID(), order.siteId, row.materialSku, lotId, quantity, purchaseOrderId, userId, now),
      );
    }
    if (!statements.length) throw new OperationsError("Không có số lượng nguyên liệu cần nhận.", 409, "nothing_to_receive");
    const nextStatus = allReceived ? "received" : "partially_received";
    await assertLedgerPeriodOpen(database, now);
    statements.unshift(database.prepare("UPDATE purchase_orders SET status = ?, received_at = CASE WHEN ? = 'received' THEN ? ELSE received_at END, updated_at = ? WHERE id = ? AND status = ? AND updated_at = ?").bind(nextStatus, nextStatus, now, now, purchaseOrderId, order.status, order.updatedAt));
    statements.push(
      database.prepare(`INSERT INTO finance_ledger_entries
        (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
        VALUES (?, ?, 'supplier_payable', 'outflow', ?, ?, NULL, NULL, NULL, NULL, 'approved', ?, ?, ?)`)
        .bind(crypto.randomUUID(), now, receivedValue, order.siteId, `Nhận nguyên liệu ${order.poCode}`, order.poCode, now),
      eventStatement(database, operationEvent("purchase-order", purchaseOrderId, command, actor, order.status, nextStatus, { receivedValue })),
    );
    const results = await database.batch(statements);
    if (results[0].meta.changes !== 1) throw new OperationsError("Đơn mua vừa được cập nhật bởi phiên khác.", 409, "purchase_receive_conflict");
    return { command, purchaseOrderId, status: nextStatus, receivedValue };
  }

  if (command === "recipe.upsert") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "cập nhật định mức");
    const productSku = boundedText(data, "productSku", 80).toLocaleUpperCase("en-US");
    if (!await database.prepare("SELECT sku FROM catalog_products WHERE sku = ? AND status = 'active'").bind(productSku).first("sku")) throw new OperationsError("Không tìm thấy thành phẩm.", 404, "catalog_product_not_found");
    const materials = objectItems(data, "materials");
    const currentVersion = Number(await database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM product_recipes WHERE product_sku = ?").bind(productSku).first("version")) || 0;
    const version = currentVersion + 1;
    const effectiveFrom = readString(data, "effectiveFrom", false) ? readIsoDate(data, "effectiveFrom") : now;
    await database.batch([
      database.prepare("UPDATE product_recipes SET effective_to = ? WHERE product_sku = ? AND effective_to IS NULL").bind(effectiveFrom, productSku),
      ...materials.map((material) => database.prepare(`INSERT INTO product_recipes
        (id, product_sku, material_sku, quantity_per_unit, unit, version, effective_from, effective_to, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
        .bind(crypto.randomUUID(), productSku, boundedText(material, "materialSku", 80).toLocaleUpperCase("en-US"), readInteger(material, "quantityPerUnit", { min: 1, max: 1_000_000_000 }), boundedText(material, "unit", 30), version, effectiveFrom, userId, now)),
      eventStatement(database, operationEvent("recipe", productSku, command, actor, String(currentVersion), String(version), { materials: materials.length })),
    ]);
    return { command, productSku, version, materialCount: materials.length };
  }

  if (command === "production.plan") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "lập kế hoạch sản xuất");
    const siteId = readString(data, "siteId");
    const targetSite = await site(database, siteId);
    if (targetSite.kind !== "central-kitchen") throw new OperationsError("Mẻ sản xuất phải thuộc bếp tổng.", 409, "production_site_not_kitchen");
    assertSiteAccess(context, siteId, "lập mẻ sản xuất");
    const productSku = boundedText(data, "productSku", 80).toLocaleUpperCase("en-US");
    if (!await database.prepare("SELECT id FROM product_recipes WHERE product_sku = ? AND effective_to IS NULL LIMIT 1").bind(productSku).first("id")) throw new OperationsError("Thành phẩm chưa có định mức đang hiệu lực.", 409, "recipe_required");
    const id = crypto.randomUUID();
    const batchCode = readString(data, "batchCode", false) || `LOT-${now.slice(2, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
    const plannedQuantity = readInteger(data, "plannedQuantity", { min: 1, max: 1_000_000 });
    await database.batch([
      database.prepare(`INSERT INTO production_batches
        (id, batch_code, site_id, product_sku, planned_quantity, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?)`)
        .bind(id, batchCode, siteId, productSku, plannedQuantity, userId, now, now),
      eventStatement(database, operationEvent("production-batch", id, command, actor, null, "planned", { batchCode, plannedQuantity })),
    ]);
    return { command, batchId: id, batchCode, status: "planned" };
  }

  if (command === "production.start") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "bắt đầu mẻ sản xuất");
    const batchId = readString(data, "batchId");
    const rows = await queryRows<ProductionBatchRow>(database.prepare("SELECT * FROM production_batches WHERE id = ? LIMIT 1").bind(batchId));
    const batch = rows[0];
    if (!batch) throw new OperationsError("Không tìm thấy mẻ sản xuất.", 404, "production_batch_not_found");
    assertSiteAccess(context, batch.siteId, "bắt đầu mẻ");
    const result = await database.batch([
      database.prepare("UPDATE production_batches SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'planned' AND updated_at = ?").bind(now, batchId, batch.updatedAt),
      eventStatement(database, operationEvent("production-batch", batchId, command, actor, "planned", "in_progress")),
    ]);
    if (result[0].meta.changes !== 1) throw new OperationsError("Mẻ vừa được cập nhật hoặc không còn ở trạng thái dự kiến.", 409, "production_start_conflict");
    return { command, batchId, status: "in_progress" };
  }

  if (command === "production.complete") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "hoàn tất mẻ sản xuất");
    const batchId = readString(data, "batchId");
    const rows = await queryRows<ProductionBatchRow>(database.prepare("SELECT * FROM production_batches WHERE id = ? LIMIT 1").bind(batchId));
    const batch = rows[0];
    if (!batch) throw new OperationsError("Không tìm thấy mẻ sản xuất.", 404, "production_batch_not_found");
    if (batch.status !== "in_progress") throw new OperationsError("Mẻ chưa ở trạng thái đang sản xuất.", 409, "production_not_in_progress");
    assertSiteAccess(context, batch.siteId, "hoàn tất mẻ");
    const producedQuantity = readInteger(data, "producedQuantity", { min: 1, max: batch.plannedQuantity });
    const rejectedQuantity = readInteger(data, "rejectedQuantity", { min: 0, max: batch.plannedQuantity, required: false });
    if (producedQuantity + rejectedQuantity > batch.plannedQuantity) throw new OperationsError("Tổng đạt và loại vượt số lượng kế hoạch.", 400, "production_quantity_invalid");
    const expiresAt = readIsoDate(data, "expiresAt");
    if (expiresAt <= now) throw new OperationsError("Hạn dùng của mẻ phải ở tương lai.", 400, "production_expiry_invalid");
    const recipes = await queryRows<{ materialSku: string; quantityPerUnit: number }>(database.prepare(`SELECT material_sku, quantity_per_unit FROM product_recipes
      WHERE product_sku = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY material_sku`).bind(batch.productSku, now, now));
    if (!recipes.length) throw new OperationsError("Không tìm thấy định mức đang hiệu lực.", 409, "recipe_required");
    const statements: RuntimePreparedStatement[] = [];
    let materialCost = 0;
    for (const recipe of recipes) {
      const required = Number(recipe.quantityPerUnit) * producedQuantity;
      const takes = allocateFefo(await materialLots(database, batch.siteId, recipe.materialSku, now), required, 1000);
      for (const take of takes) {
        materialCost += take.totalCost;
        const usageId = crypto.randomUUID();
        statements.push(
          database.prepare("UPDATE material_stock_lots SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'depleted' ELSE status END WHERE id = ? AND quantity >= ?").bind(take.quantity, take.quantity, take.lot.id, take.quantity),
          database.prepare("UPDATE operation_inventory SET on_hand = on_hand - ?, updated_at = ? WHERE site_id = ? AND sku = ? AND on_hand >= ?").bind(take.quantity, now, batch.siteId, recipe.materialSku, take.quantity),
          database.prepare(`INSERT INTO production_material_usage
            (id, batch_id, material_sku, material_lot_id, quantity_used, unit_cost, total_cost, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(usageId, batchId, recipe.materialSku, take.lot.id, take.quantity, take.lot.unitCost, take.totalCost, now),
          database.prepare(`INSERT INTO material_stock_movements
            (id, site_id, material_sku, lot_id, movement_type, quantity, reference_type, reference_id, created_by, created_at)
            VALUES (?, ?, ?, ?, 'production_use', ?, 'production-batch', ?, ?, ?)`)
            .bind(crypto.randomUUID(), batch.siteId, recipe.materialSku, take.lot.id, -take.quantity, batchId, userId, now),
        );
      }
    }
    const laborCost = readInteger(data, "laborCost", { min: 0, max: 10_000_000_000, required: false });
    const overheadCost = readInteger(data, "overheadCost", { min: 0, max: 10_000_000_000, required: false });
    const unitCost = Math.round((materialCost + laborCost + overheadCost) / producedQuantity);
    const finishedLotId = crypto.randomUUID();
    const event = operationEvent("production-batch", batchId, command, actor, "in_progress", "completed", { producedQuantity, rejectedQuantity, materialCost, laborCost, overheadCost, unitCost });
    const results = await database.batch([
      database.prepare(`UPDATE production_batches SET produced_quantity = ?, rejected_quantity = ?, status = 'completed',
        material_cost = ?, labor_cost = ?, overhead_cost = ?, unit_cost = ?, produced_at = ?, expires_at = ?,
        quality_check_by = ?, quality_note = ?, updated_at = ?
        WHERE id = ? AND status = 'in_progress' AND updated_at = ?`)
        .bind(producedQuantity, rejectedQuantity, materialCost, laborCost, overheadCost, unitCost, now, expiresAt, userId, boundedText(data, "qualityNote", 500, false), now, batchId, batch.updatedAt),
      ...statements,
      database.prepare(`INSERT INTO site_stock_lots
        (id, site_id, product_sku, batch_id, quantity, unit_cost, expires_at, received_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available')`)
        .bind(finishedLotId, batch.siteId, batch.productSku, batchId, producedQuantity, unitCost, expiresAt, now),
      database.prepare(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status, updated_at)
        VALUES (?, ?, ?, ?, 0, 1, 'available', ?)
        ON CONFLICT(site_id, product_sku) DO UPDATE SET on_hand = catalog_site_stock.on_hand + excluded.on_hand,
          track_stock = 1, status = 'available', updated_at = excluded.updated_at`)
        .bind(`stock-${batch.siteId}-${batch.productSku}`, batch.siteId, batch.productSku, producedQuantity, now),
      database.prepare(`INSERT INTO catalog_stock_movements
        (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
        VALUES (?, NULL, ?, ?, 'production_in', ?, ?)`)
        .bind(crypto.randomUUID(), batch.siteId, batch.productSku, producedQuantity, now),
      eventStatement(database, event),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Mẻ vừa được cập nhật bởi phiên khác.", 409, "production_complete_conflict");
    return { command, batchId, status: "completed", producedQuantity, materialCost, laborCost, overheadCost, unitCost, lotId: finishedLotId };
  }

  if (command === "transfer.request") {
    assertActor(actor, ["owner", "super-admin", "kitchen", "store-owner"], "tạo phiếu điều chuyển");
    const fromSiteId = readString(data, "fromSiteId");
    const toSiteId = readString(data, "toSiteId");
    if (fromSiteId === toSiteId) throw new OperationsError("Điểm xuất và nhận phải khác nhau.", 400, "transfer_same_site");
    const [fromSite, toSite] = await Promise.all([site(database, fromSiteId), site(database, toSiteId)]);
    if (fromSite.kind !== "central-kitchen") throw new OperationsError("Đợt này chỉ hỗ trợ điều chuyển từ bếp tổng.", 409, "transfer_source_not_kitchen");
    if (!actor.scope?.isGlobal && !actorCanAccessSite(actor, fromSiteId) && !actorCanAccessSite(actor, toSiteId)) throw new OperationsError("Phiếu điều chuyển nằm ngoài phạm vi.", 403, "entity_out_of_scope");
    const parsed = [] as Array<{ id: string; sku: string; quantity: number; transferPrice: number; unitCost: number }>;
    for (const input of objectItems(data)) {
      const sku = boundedText(input, "productSku", 80).toLocaleUpperCase("en-US");
      const quantity = readInteger(input, "quantity", { min: 1, max: 1_000_000 });
      const validLots = await productLots(database, fromSiteId, sku, now);
      const takes = allocateFefo(validLots, quantity);
      parsed.push({ id: crypto.randomUUID(), sku, quantity, transferPrice: await transferPrice(database, sku, toSite.kind, now), unitCost: Math.round(takes.reduce((sum, take) => sum + take.totalCost, 0) / quantity) });
    }
    const id = crypto.randomUUID();
    const transferCode = readString(data, "transferCode", false) || `DC-${now.slice(2, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
    const transferValue = parsed.reduce((sum, item) => sum + item.quantity * item.transferPrice, 0);
    const costValue = parsed.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    await database.batch([
      database.prepare(`INSERT INTO transfer_orders
        (id, transfer_code, from_site_id, to_site_id, status, requested_by, requested_at, transfer_value, cost_value,
         vehicle, driver_name, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, transferCode, fromSiteId, toSiteId, userId, now, transferValue, costValue, boundedText(data, "vehicle", 80, false), boundedText(data, "driverName", 120, false), boundedText(data, "note", 500, false), now, now),
      ...parsed.map((item) => database.prepare(`INSERT INTO transfer_order_items
        (id, transfer_id, product_sku, quantity_requested, transfer_price, unit_cost)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(item.id, id, item.sku, item.quantity, item.transferPrice, item.unitCost)),
      eventStatement(database, operationEvent("transfer", id, command, actor, null, "requested", { transferCode, fromSiteId, toSiteId, transferValue })),
    ]);
    return { command, transferId: id, transferCode, status: "requested", transferValue, costValue };
  }

  if (command === "transfer.approve") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "duyệt phiếu điều chuyển");
    const transferId = readString(data, "transferId");
    const transfer = (await queryRows<TransferRow>(database.prepare("SELECT * FROM transfer_orders WHERE id = ? LIMIT 1").bind(transferId)))[0];
    if (!transfer) throw new OperationsError("Không tìm thấy phiếu điều chuyển.", 404, "transfer_not_found");
    if (!actor.scope?.isGlobal) assertSiteAccess(context, transfer.fromSiteId, "duyệt phiếu");
    const account = (await queryRows<{ balance: number; creditLimit: number }>(database.prepare("SELECT balance, credit_limit FROM internal_accounts WHERE site_id = ? LIMIT 1").bind(transfer.toSiteId)))[0];
    const projected = Number(account?.balance || 0) + Number(transfer.transferValue);
    const override = Boolean(data.creditOverride) && ["owner", "super-admin"].includes(actor.role);
    if (Number(account?.creditLimit || 0) > 0 && projected > Number(account.creditLimit) && !override) {
      await database.prepare(`INSERT OR IGNORE INTO operation_alerts
        (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        VALUES (?, 'critical', 'internal-credit', ?, ?, 'open', 'owner', 'transfer', ?, ?, ?)`)
        .bind(`transfer-credit-${transferId}`, `Phiếu ${transfer.transferCode} vượt hạn mức`, `Dư nợ dự kiến ${projected}đ vượt hạn mức ${account.creditLimit}đ.`, transferId, now, now).run();
      throw new OperationsError("Công nợ dự kiến vượt hạn mức; cần owner duyệt ngoại lệ.", 409, "internal_credit_limit_exceeded", { projected, creditLimit: account.creditLimit });
    }
    const results = await database.batch([
      database.prepare("UPDATE transfer_orders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'requested' AND updated_at = ?").bind(userId, now, now, transferId, transfer.updatedAt),
      eventStatement(database, operationEvent("transfer", transferId, command, actor, "requested", "approved", { projectedBalance: projected, override })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu vừa được cập nhật hoặc không còn chờ duyệt.", 409, "transfer_approve_conflict");
    return { command, transferId, status: "approved", projectedBalance: projected };
  }

  if (command === "transfer.pack") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "đóng gói phiếu điều chuyển");
    const transferId = readString(data, "transferId");
    const transfer = (await queryRows<TransferRow>(database.prepare("SELECT * FROM transfer_orders WHERE id = ? LIMIT 1").bind(transferId)))[0];
    if (!transfer) throw new OperationsError("Không tìm thấy phiếu điều chuyển.", 404, "transfer_not_found");
    if (transfer.status !== "approved") throw new OperationsError("Phiếu chưa được duyệt hoặc đã đóng gói.", 409, "transfer_not_approved");
    if (!actor.scope?.isGlobal) assertSiteAccess(context, transfer.fromSiteId, "đóng gói");
    const items = await queryRows<TransferItemRow>(database.prepare("SELECT * FROM transfer_order_items WHERE transfer_id = ? ORDER BY id").bind(transferId));
    const statements: RuntimePreparedStatement[] = [];
    let actualTransferValue = 0;
    let actualCostValue = 0;
    for (const item of items) {
      const quantity = Number(item.quantityRequested);
      const takes = allocateFefo(await productLots(database, transfer.fromSiteId, item.productSku, now), quantity);
      actualTransferValue += quantity * Number(item.transferPrice);
      actualCostValue += takes.reduce((sum, take) => sum + take.totalCost, 0);
      statements.push(database.prepare("UPDATE transfer_order_items SET quantity_shipped = ?, unit_cost = ?, batch_id = ?, expires_at = ? WHERE id = ? AND quantity_shipped = 0").bind(quantity, Math.round(takes.reduce((sum, take) => sum + take.totalCost, 0) / quantity), takes[0]?.lot.batchId || null, takes[0]?.lot.expiresAt || null, item.id));
      for (const take of takes) {
        statements.push(
          database.prepare("UPDATE site_stock_lots SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'depleted' ELSE status END WHERE id = ? AND quantity >= ?").bind(take.quantity, take.quantity, take.lot.id, take.quantity),
          database.prepare(`INSERT INTO transfer_item_lots
            (id, transfer_item_id, source_lot_id, batch_id, quantity_shipped, quantity_received, unit_cost, expires_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
            .bind(crypto.randomUUID(), item.id, take.lot.id, take.lot.batchId, take.quantity, take.lot.unitCost, take.lot.expiresAt),
        );
      }
      statements.push(
        database.prepare("UPDATE catalog_site_stock SET on_hand = on_hand - ?, updated_at = ? WHERE site_id = ? AND product_sku = ? AND on_hand - reserved >= ?").bind(quantity, now, transfer.fromSiteId, item.productSku, quantity),
        database.prepare(`INSERT INTO catalog_stock_movements
          (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          VALUES (?, NULL, ?, ?, 'transfer_out', ?, ?)`)
          .bind(crypto.randomUUID(), transfer.fromSiteId, item.productSku, -quantity, now),
      );
    }
    const results = await database.batch([
      database.prepare("UPDATE transfer_orders SET status = 'packed', packed_by = ?, packed_at = ?, transfer_value = ?, cost_value = ?, updated_at = ? WHERE id = ? AND status = 'approved' AND updated_at = ?").bind(userId, now, actualTransferValue, actualCostValue, now, transferId, transfer.updatedAt),
      ...statements,
      eventStatement(database, operationEvent("transfer", transferId, command, actor, "approved", "packed", { actualTransferValue, actualCostValue })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu vừa được cập nhật bởi phiên khác.", 409, "transfer_pack_conflict");
    return { command, transferId, status: "packed", transferValue: actualTransferValue, costValue: actualCostValue };
  }

  if (command === "transfer.ship") {
    assertActor(actor, ["owner", "super-admin", "kitchen"], "xuất phiếu điều chuyển");
    const transferId = readString(data, "transferId");
    const transfer = (await queryRows<TransferRow>(database.prepare("SELECT * FROM transfer_orders WHERE id = ? LIMIT 1").bind(transferId)))[0];
    if (!transfer) throw new OperationsError("Không tìm thấy phiếu điều chuyển.", 404, "transfer_not_found");
    if (!actor.scope?.isGlobal) assertSiteAccess(context, transfer.fromSiteId, "xuất phiếu");
    const results = await database.batch([
      database.prepare("UPDATE transfer_orders SET status = 'in_transit', shipped_at = ?, vehicle = ?, driver_name = ?, updated_at = ? WHERE id = ? AND status = 'packed' AND updated_at = ?").bind(now, boundedText(data, "vehicle", 80, false), boundedText(data, "driverName", 120, false), now, transferId, transfer.updatedAt),
      eventStatement(database, operationEvent("transfer", transferId, command, actor, "packed", "in_transit")),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu chưa đóng gói hoặc vừa được xuất bởi phiên khác.", 409, "transfer_ship_conflict");
    return { command, transferId, status: "in_transit" };
  }

  if (command === "transfer.receive") {
    assertActor(actor, ["owner", "super-admin", "store-owner", "store-staff"], "nhận phiếu điều chuyển");
    const transferId = readString(data, "transferId");
    const transfer = (await queryRows<TransferRow>(database.prepare("SELECT * FROM transfer_orders WHERE id = ? LIMIT 1").bind(transferId)))[0];
    if (!transfer) throw new OperationsError("Không tìm thấy phiếu điều chuyển.", 404, "transfer_not_found");
    if (transfer.status !== "in_transit") throw new OperationsError("Phiếu không còn ở trạng thái đang giao; không thể nhận lần hai.", 409, "transfer_not_receivable");
    if (!actor.scope?.isGlobal) assertSiteAccess(context, transfer.toSiteId, "nhận hàng");
    const items = await queryRows<TransferItemRow>(database.prepare("SELECT * FROM transfer_order_items WHERE transfer_id = ? ORDER BY id").bind(transferId));
    const requested = Array.isArray(data.items) ? data.items as JsonRecord[] : [];
    const receivedByItem = new Map(requested.map((item) => [readString(item, "itemId"), item]));
    const statements: RuntimePreparedStatement[] = [];
    let debtIncrease = 0;
    let receivedTotal = 0;
    let shippedTotal = 0;
    for (const item of items) {
      const input = receivedByItem.get(item.id);
      const received = input ? readInteger(input, "quantityReceived", { min: 0, max: item.quantityShipped }) : Number(item.quantityShipped);
      const damaged = input ? readInteger(input, "quantityDamaged", { min: 0, max: item.quantityShipped - received, required: false }) : 0;
      const missing = Number(item.quantityShipped) - received - damaged;
      const reason = input ? boundedText(input, "reason", 300, false) : "";
      if ((missing > 0 || damaged > 0) && reason.length < 3) throw new OperationsError("Nhận thiếu/hỏng cần ghi lý do.", 400, "transfer_discrepancy_reason_required");
      shippedTotal += Number(item.quantityShipped);
      receivedTotal += received;
      debtIncrease += received * Number(item.transferPrice);
      let remaining = received;
      const allocations = await queryRows<{ id: string; sourceLotId: string; batchId: string | null; quantityShipped: number; unitCost: number; expiresAt: string | null }>(database.prepare("SELECT * FROM transfer_item_lots WHERE transfer_item_id = ? ORDER BY id").bind(item.id));
      for (const allocation of allocations) {
        if (remaining <= 0) break;
        const quantity = Math.min(remaining, Number(allocation.quantityShipped));
        remaining -= quantity;
        statements.push(
          database.prepare("UPDATE transfer_item_lots SET quantity_received = ? WHERE id = ? AND quantity_received = 0").bind(quantity, allocation.id),
          database.prepare(`INSERT INTO site_stock_lots
            (id, site_id, product_sku, batch_id, quantity, unit_cost, expires_at, received_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available')`)
            .bind(`received-${transferId}-${allocation.id}`, transfer.toSiteId, item.productSku, allocation.batchId, quantity, allocation.unitCost, allocation.expiresAt, now),
        );
      }
      statements.push(
        database.prepare("UPDATE transfer_order_items SET quantity_received = ?, quantity_rejected = ?, reject_reason = ? WHERE id = ? AND quantity_received = 0 AND quantity_rejected = 0").bind(received, missing + damaged, reason, item.id),
        database.prepare(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status, updated_at)
          VALUES (?, ?, ?, ?, 0, 1, 'available', ?)
          ON CONFLICT(site_id, product_sku) DO UPDATE SET on_hand = catalog_site_stock.on_hand + excluded.on_hand,
            track_stock = 1, status = 'available', updated_at = excluded.updated_at`)
          .bind(`stock-${transfer.toSiteId}-${item.productSku}`, transfer.toSiteId, item.productSku, received, now),
        database.prepare(`INSERT INTO catalog_stock_movements
          (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          VALUES (?, NULL, ?, ?, 'receive', ?, ?)`)
          .bind(crypto.randomUUID(), transfer.toSiteId, item.productSku, received, now),
      );
      if (missing > 0 || damaged > 0) statements.push(database.prepare(`INSERT INTO transfer_discrepancies
        (id, transfer_id, transfer_item_id, missing_quantity, damaged_quantity, reason, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
        .bind(crypto.randomUUID(), transferId, item.id, missing, damaged, reason, userId, now));
    }
    const nextStatus = receivedTotal === shippedTotal ? "received" : "partially_received";
    const existingAccount = (await queryRows<{ balance: number; creditLimit: number }>(database.prepare("SELECT balance, credit_limit FROM internal_accounts WHERE site_id = ? LIMIT 1").bind(transfer.toSiteId)))[0];
    const balanceAfter = Number(existingAccount?.balance || 0) + debtIncrease;
    const entryId = `internal-transfer-${transferId}`;
    await assertLedgerPeriodOpen(database, now);
    const results = await database.batch([
      database.prepare("UPDATE transfer_orders SET status = ?, received_by = ?, received_at = ?, transfer_value = ?, updated_at = ? WHERE id = ? AND status = 'in_transit' AND updated_at = ?").bind(nextStatus, userId, now, debtIncrease, now, transferId, transfer.updatedAt),
      ...statements,
      database.prepare(`INSERT INTO internal_accounts (id, site_id, balance, credit_limit, updated_at)
        VALUES (?, ?, 0, 0, ?) ON CONFLICT(site_id) DO NOTHING`)
        .bind(`internal-account-${transfer.toSiteId}`, transfer.toSiteId, now),
      database.prepare(`INSERT INTO internal_account_entries
        (id, site_id, entry_type, amount, balance_after, transfer_id, payment_reference, description, created_by, created_at)
        VALUES (?, ?, 'transfer', ?, ?, ?, '', ?, ?, ?)`)
        .bind(entryId, transfer.toSiteId, debtIncrease, balanceAfter, transferId, `Nhận phiếu ${transfer.transferCode}`, userId, now),
      database.prepare("UPDATE internal_accounts SET balance = ?, updated_at = ? WHERE site_id = ?").bind(balanceAfter, now, transfer.toSiteId),
      eventStatement(database, operationEvent("transfer", transferId, command, actor, "in_transit", nextStatus, { receivedTotal, shippedTotal, debtIncrease, balanceAfter })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu vừa được nhận bởi phiên khác.", 409, "transfer_receive_conflict");
    return { command, transferId, status: nextStatus, receivedQuantity: receivedTotal, shippedQuantity: shippedTotal, debtIncrease, balanceAfter };
  }

  if (command === "transfer.reject") {
    assertActor(actor, ["owner", "super-admin", "store-owner", "store-staff"], "từ chối phiếu điều chuyển");
    const transferId = readString(data, "transferId");
    const transfer = (await queryRows<TransferRow>(database.prepare("SELECT * FROM transfer_orders WHERE id = ? LIMIT 1").bind(transferId)))[0];
    if (!transfer) throw new OperationsError("Không tìm thấy phiếu điều chuyển.", 404, "transfer_not_found");
    if (!["requested", "approved"].includes(transfer.status)) throw new OperationsError("Phiếu đã xuất kho; cần dùng luồng nhận thiếu/hỏng.", 409, "transfer_reject_after_ship_forbidden");
    if (!actor.scope?.isGlobal) assertSiteAccess(context, transfer.toSiteId, "từ chối phiếu");
    const reason = boundedText(data, "reason", 300);
    const results = await database.batch([
      database.prepare("UPDATE transfer_orders SET status = 'rejected', note = ?, received_by = ?, received_at = ?, updated_at = ? WHERE id = ? AND status = ? AND updated_at = ?").bind(reason, userId, now, now, transferId, transfer.status, transfer.updatedAt),
      eventStatement(database, operationEvent("transfer", transferId, command, actor, transfer.status, "rejected", { reason })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu vừa được cập nhật bởi phiên khác.", 409, "transfer_reject_conflict");
    return { command, transferId, status: "rejected" };
  }

  if (command === "stockcount.open") {
    assertActor(actor, ["owner", "super-admin", "kitchen", "store-owner", "store-staff"], "mở kiểm kê");
    const siteId = readString(data, "siteId");
    assertSiteAccess(context, siteId, "kiểm kê");
    if (await database.prepare("SELECT id FROM stock_counts WHERE site_id = ? AND status IN ('open','submitted') LIMIT 1").bind(siteId).first("id")) throw new OperationsError("Điểm này đang có phiếu kiểm kê chưa kết thúc.", 409, "stockcount_already_open");
    const stocks = await queryRows<{ productSku: string; onHand: number }>(database.prepare("SELECT product_sku, on_hand FROM catalog_site_stock WHERE site_id = ? AND track_stock = 1 ORDER BY product_sku").bind(siteId));
    const id = crypto.randomUUID();
    const countType = readString(data, "countType", false) || "shift_close";
    if (!["shift_close", "daily", "monthly", "spot"].includes(countType)) throw new OperationsError("Loại kiểm kê không hợp lệ.", 400, "invalid_stockcount_type");
    await database.batch([
      database.prepare(`INSERT INTO stock_counts
        (id, site_id, count_type, status, counted_by, started_at, variance_value, updated_at)
        VALUES (?, ?, ?, 'open', ?, ?, 0, ?)`)
        .bind(id, siteId, countType, userId, now, now),
      ...stocks.map((stock) => database.prepare(`INSERT INTO stock_count_items
        (id, count_id, product_sku, system_quantity, counted_quantity, variance, variance_reason)
        VALUES (?, ?, ?, ?, ?, 0, '')`)
        .bind(crypto.randomUUID(), id, stock.productSku, stock.onHand, stock.onHand)),
      eventStatement(database, operationEvent("stock-count", id, command, actor, null, "open", { siteId, itemCount: stocks.length })),
    ]);
    return { command, countId: id, status: "open", itemCount: stocks.length };
  }

  if (command === "stockcount.submit") {
    assertActor(actor, ["owner", "super-admin", "kitchen", "store-owner", "store-staff"], "gửi kiểm kê");
    const countId = readString(data, "countId");
    const count = (await queryRows<{ id: string; siteId: string; status: string; updatedAt: string }>(database.prepare("SELECT * FROM stock_counts WHERE id = ? LIMIT 1").bind(countId)))[0];
    if (!count) throw new OperationsError("Không tìm thấy phiếu kiểm kê.", 404, "stockcount_not_found");
    if (count.status !== "open") throw new OperationsError("Phiếu không còn mở.", 409, "stockcount_not_open");
    assertSiteAccess(context, count.siteId, "gửi kiểm kê");
    const inputs = objectItems(data);
    const existing = await queryRows<{ id: string; productSku: string; systemQuantity: number }>(database.prepare("SELECT * FROM stock_count_items WHERE count_id = ?").bind(countId));
    const bySku = new Map(existing.map((item) => [item.productSku, item]));
    let varianceValue = 0;
    const statements: RuntimePreparedStatement[] = [];
    for (const input of inputs) {
      const sku = boundedText(input, "productSku", 80).toLocaleUpperCase("en-US");
      const row = bySku.get(sku);
      if (!row) throw new OperationsError(`SKU ${sku} không thuộc phiếu kiểm kê.`, 400, "stockcount_item_not_found");
      const counted = readInteger(input, "countedQuantity", { min: 0, max: 1_000_000_000 });
      const variance = counted - Number(row.systemQuantity);
      const reason = boundedText(input, "reason", 300, false);
      if (variance !== 0 && reason.length < 3) throw new OperationsError("Chênh lệch kiểm kê cần ghi lý do.", 400, "stockcount_reason_required");
      varianceValue += Math.abs(variance) * await averageProductCost(database, count.siteId, sku, now);
      statements.push(database.prepare("UPDATE stock_count_items SET counted_quantity = ?, variance = ?, variance_reason = ? WHERE id = ?").bind(counted, variance, reason, row.id));
    }
    const results = await database.batch([
      database.prepare("UPDATE stock_counts SET status = 'submitted', variance_value = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open' AND updated_at = ?").bind(varianceValue, now, now, countId, count.updatedAt),
      ...statements,
      eventStatement(database, operationEvent("stock-count", countId, command, actor, "open", "submitted", { varianceValue })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu vừa được cập nhật bởi phiên khác.", 409, "stockcount_submit_conflict");
    return { command, countId, status: "submitted", varianceValue };
  }

  if (command === "stockcount.approve") {
    assertActor(actor, ["owner", "super-admin", "store-owner"], "duyệt kiểm kê");
    const countId = readString(data, "countId");
    const count = (await queryRows<{ id: string; siteId: string; status: string; updatedAt: string; varianceValue: number }>(database.prepare("SELECT * FROM stock_counts WHERE id = ? LIMIT 1").bind(countId)))[0];
    if (!count) throw new OperationsError("Không tìm thấy phiếu kiểm kê.", 404, "stockcount_not_found");
    if (count.status !== "submitted") throw new OperationsError("Phiếu chưa được gửi duyệt.", 409, "stockcount_not_submitted");
    assertSiteAccess(context, count.siteId, "duyệt kiểm kê");
    const items = await queryRows<{ id: string; productSku: string; variance: number; varianceReason: string }>(database.prepare("SELECT * FROM stock_count_items WHERE count_id = ? AND variance != 0").bind(countId));
    if (items.some((item) => Number(item.variance) < 0)) await assertLedgerPeriodOpen(database, now);
    const statements: RuntimePreparedStatement[] = [];
    for (const item of items) {
      const variance = Number(item.variance);
      const unitCost = await averageProductCost(database, count.siteId, item.productSku, now);
      if (variance < 0) {
        const wasteCost = Math.abs(variance) * unitCost;
        const takes = allocateFefo(await productLots(database, count.siteId, item.productSku, now), Math.abs(variance));
        for (const take of takes) statements.push(database.prepare("UPDATE site_stock_lots SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'depleted' ELSE status END WHERE id = ? AND quantity >= ?").bind(take.quantity, take.quantity, take.lot.id, take.quantity));
        statements.push(database.prepare(`INSERT INTO waste_records
          (id, site_id, product_sku, material_sku, batch_id, quantity, unit_cost, total_cost, reason, photo_url, recorded_by, approved_by, created_at)
          VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, 'count_variance', '', ?, ?, ?)`)
          .bind(crypto.randomUUID(), count.siteId, item.productSku, Math.abs(variance), unitCost, wasteCost, userId, userId, now),
          database.prepare(`INSERT INTO finance_ledger_entries
            (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
            VALUES (?, ?, 'stock_count_variance', 'outflow', ?, ?, NULL, NULL, NULL, NULL, 'posted', ?, ?, ?)`)
            .bind(`ledger-count-${countId}-${item.id}`, now, wasteCost, count.siteId, `Chênh lệch kiểm kê ${item.productSku}`, countId, now));
      } else {
        statements.push(database.prepare(`INSERT INTO site_stock_lots
          (id, site_id, product_sku, batch_id, quantity, unit_cost, expires_at, received_at, status)
          VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, 'available')`)
          .bind(crypto.randomUUID(), count.siteId, item.productSku, variance, unitCost, now));
      }
      statements.push(
        database.prepare("UPDATE catalog_site_stock SET on_hand = on_hand + ?, updated_at = ? WHERE site_id = ? AND product_sku = ? AND on_hand + ? >= reserved").bind(variance, now, count.siteId, item.productSku, variance),
        database.prepare(`INSERT INTO catalog_stock_movements
          (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          VALUES (?, NULL, ?, ?, 'count_adjust', ?, ?)`)
          .bind(crypto.randomUUID(), count.siteId, item.productSku, variance, now),
      );
    }
    if (items.some((item) => Math.abs(Number(item.variance)) >= 3)) statements.push(database.prepare(`INSERT OR IGNORE INTO operation_alerts
      (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'critical', 'stock-variance', ?, ?, 'open', 'owner', 'stock-count', ?, ?, ?)`)
      .bind(`stockcount-alert-${countId}`, `Kiểm kê ${countId} lệch lớn`, `Giá trị chênh lệch ${count.varianceValue}đ; cần rà soát nguyên nhân.`, countId, now, now));
    const results = await database.batch([
      database.prepare("UPDATE stock_counts SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ? AND status = 'submitted' AND updated_at = ?").bind(userId, now, countId, count.updatedAt),
      ...statements,
      eventStatement(database, operationEvent("stock-count", countId, command, actor, "submitted", "approved", { varianceValue: count.varianceValue })),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Phiếu vừa được duyệt bởi phiên khác.", 409, "stockcount_approve_conflict");
    return { command, countId, status: "approved", adjustedItems: items.length, varianceValue: count.varianceValue };
  }

  if (command === "waste.record") {
    assertActor(actor, ["owner", "super-admin", "kitchen", "store-owner", "store-staff"], "ghi hao hụt");
    const siteId = readString(data, "siteId");
    assertSiteAccess(context, siteId, "ghi hao hụt");
    const productSku = boundedText(data, "productSku", 80, false).toLocaleUpperCase("en-US");
    const materialSku = boundedText(data, "materialSku", 80, false).toLocaleUpperCase("en-US");
    if (Boolean(productSku) === Boolean(materialSku)) throw new OperationsError("Chỉ chọn một thành phẩm hoặc một nguyên liệu.", 400, "waste_item_invalid");
    const quantity = readInteger(data, "quantity", { min: 1, max: 1_000_000_000 });
    const reason = readString(data, "reason");
    if (!["expired", "damaged", "quality", "customer_return", "theft"].includes(reason)) throw new OperationsError("Lý do hao hụt không hợp lệ.", 400, "waste_reason_invalid");
    const statements: RuntimePreparedStatement[] = [];
    let totalCost = 0;
    let unitCost = 0;
    let batchId: string | null = null;
    const id = crypto.randomUUID();
    if (productSku) {
      const takes = allocateFefo(await productLots(database, siteId, productSku, now, reason === "expired"), quantity);
      totalCost = takes.reduce((sum, take) => sum + take.totalCost, 0);
      unitCost = Math.round(totalCost / quantity);
      batchId = takes[0]?.lot.batchId || null;
      for (const take of takes) statements.push(database.prepare("UPDATE site_stock_lots SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'depleted' ELSE status END WHERE id = ? AND quantity >= ?").bind(take.quantity, take.quantity, take.lot.id, take.quantity));
      statements.push(
        database.prepare("UPDATE catalog_site_stock SET on_hand = on_hand - ?, updated_at = ? WHERE site_id = ? AND product_sku = ? AND on_hand - reserved >= ?").bind(quantity, now, siteId, productSku, quantity),
        database.prepare(`INSERT INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          VALUES (?, NULL, ?, ?, 'waste', ?, ?)`)
          .bind(crypto.randomUUID(), siteId, productSku, -quantity, now),
      );
    } else {
      const takes = allocateFefo(await materialLots(database, siteId, materialSku, now), quantity, 1000);
      totalCost = takes.reduce((sum, take) => sum + take.totalCost, 0);
      unitCost = Math.round(totalCost * 1000 / quantity);
      for (const take of takes) statements.push(
        database.prepare("UPDATE material_stock_lots SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'depleted' ELSE status END WHERE id = ? AND quantity >= ?").bind(take.quantity, take.quantity, take.lot.id, take.quantity),
        database.prepare(`INSERT INTO material_stock_movements
          (id, site_id, material_sku, lot_id, movement_type, quantity, reference_type, reference_id, created_by, created_at)
          VALUES (?, ?, ?, ?, 'waste', ?, 'waste-record', ?, ?, ?)`)
          .bind(crypto.randomUUID(), siteId, materialSku, take.lot.id, -take.quantity, id, userId, now),
      );
      statements.push(database.prepare("UPDATE operation_inventory SET on_hand = on_hand - ?, updated_at = ? WHERE site_id = ? AND sku = ? AND on_hand - reserved >= ?").bind(quantity, now, siteId, materialSku, quantity));
    }
    await assertLedgerPeriodOpen(database, now);
    await database.batch([
      ...statements,
      database.prepare(`INSERT INTO waste_records
        (id, site_id, product_sku, material_sku, batch_id, quantity, unit_cost, total_cost, reason, photo_url, recorded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, siteId, productSku || null, materialSku || null, batchId, quantity, unitCost, totalCost, reason, boundedText(data, "photoUrl", 500, false), userId, now),
      database.prepare(`INSERT INTO finance_ledger_entries
        (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
        VALUES (?, ?, 'waste_expense', 'outflow', ?, ?, NULL, NULL, NULL, NULL, 'posted', ?, ?, ?)`)
        .bind(`ledger-waste-${id}`, now, totalCost, siteId, `Hao hụt ${productSku || materialSku}: ${reason}`, id, now),
      eventStatement(database, operationEvent("waste", id, command, actor, null, "recorded", { siteId, productSku, materialSku, quantity, totalCost, reason })),
    ]);
    return { command, wasteId: id, quantity, unitCost, totalCost };
  }

  return null;
}
