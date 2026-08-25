import type { RuntimeDatabase, RuntimePreparedStatement } from "../db/runtime-database.ts";
import { OperationsError, type Actor } from "./operations-types.ts";
import { queryRows } from "./operations-sql.ts";

export type StockLot = {
  id: string;
  siteId: string;
  productSku: string;
  batchId: string | null;
  quantity: number;
  unitCost: number;
  expiresAt: string | null;
  receivedAt: string;
  status: string;
};

export type MaterialLot = {
  id: string;
  siteId: string;
  materialSku: string;
  quantity: number;
  unitCost: number;
  expiresAt: string | null;
  receivedAt: string;
  status: string;
};

export type LotTake<T> = { lot: T; quantity: number; totalCost: number };

export function allocateFefo<T extends { quantity: number; unitCost: number }>(lots: T[], requested: number, scale = 1): LotTake<T>[] {
  let remaining = requested;
  const takes: LotTake<T>[] = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, Number(lot.quantity));
    if (quantity <= 0) continue;
    takes.push({ lot, quantity, totalCost: Math.round(quantity * Number(lot.unitCost) / scale) });
    remaining -= quantity;
  }
  if (remaining > 0) throw new OperationsError("Tồn theo lô không đủ hoặc phần còn lại đã hết hạn.", 409, "insufficient_fefo_stock", { requested, available: requested - remaining });
  return takes;
}

export async function productLots(database: RuntimeDatabase, siteId: string, productSku: string, at: string, includeExpired = false) {
  return queryRows<StockLot>(database.prepare(`SELECT * FROM site_stock_lots
    WHERE site_id = ? AND product_sku = ? AND status = 'available' AND quantity > 0
      ${includeExpired ? "" : "AND (expires_at IS NULL OR expires_at > ?)"}
    ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id`
  ).bind(...(includeExpired ? [siteId, productSku] : [siteId, productSku, at])));
}

export async function materialLots(database: RuntimeDatabase, siteId: string, materialSku: string, at: string) {
  return queryRows<MaterialLot>(database.prepare(`SELECT * FROM material_stock_lots
    WHERE site_id = ? AND material_sku = ? AND status = 'available' AND quantity > 0
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, received_at, id`
  ).bind(siteId, materialSku, at));
}

export async function estimateOrderLotCost(database: RuntimeDatabase, siteId: string, requestedBySku: Map<string, number>, at: string) {
  let totalCost = 0;
  let allTrackedProductsHaveLots = true;
  for (const [productSku, quantity] of requestedBySku) {
    const stock = await queryRows<{ trackStock: number }>(database.prepare("SELECT track_stock FROM catalog_site_stock WHERE site_id = ? AND product_sku = ? LIMIT 1").bind(siteId, productSku));
    if (!Boolean(stock[0]?.trackStock)) {
      allTrackedProductsHaveLots = false;
      continue;
    }
    const allLots = await productLots(database, siteId, productSku, at, true);
    if (!allLots.length) {
      allTrackedProductsHaveLots = false;
      continue;
    }
    const validLots = allLots.filter((lot) => !lot.expiresAt || lot.expiresAt > at);
    totalCost += allocateFefo(validLots, quantity).reduce((sum, take) => sum + take.totalCost, 0);
  }
  return { totalCost, hasCompleteLotCost: allTrackedProductsHaveLots && requestedBySku.size > 0 };
}

export async function prepareOrderLotConsumption(database: RuntimeDatabase, orderId: string, siteId: string, at: string) {
  const items = await queryRows<{ id: string; productCode: string; quantity: number; trackStock: number }>(database.prepare(`SELECT i.id, i.product_code, i.quantity, COALESCE(s.track_stock, 0) AS track_stock
    FROM operation_order_items i
    LEFT JOIN catalog_site_stock s ON s.site_id = ? AND s.product_sku = i.product_code
    WHERE i.order_id = ? ORDER BY i.id`).bind(siteId, orderId));
  const statements: RuntimePreparedStatement[] = [];
  let totalCost = 0;
  let actual = items.length > 0;
  for (const item of items) {
    if (!Boolean(item.trackStock)) {
      actual = false;
      continue;
    }
    const lots = await productLots(database, siteId, item.productCode, at);
    if (!lots.length) {
      actual = false;
      continue;
    }
    const takes = allocateFefo(lots, Number(item.quantity));
    for (const take of takes) {
      totalCost += take.totalCost;
      const consumptionId = `consume-${orderId}-${item.id}-${take.lot.id}`;
      statements.push(
        database.prepare("UPDATE site_stock_lots SET quantity = quantity - ?, status = CASE WHEN quantity - ? = 0 THEN 'depleted' ELSE status END WHERE id = ? AND quantity >= ?").bind(take.quantity, take.quantity, take.lot.id, take.quantity),
        database.prepare(`INSERT OR IGNORE INTO order_item_lot_consumptions
          (id, order_id, order_item_id, site_stock_lot_id, batch_id, quantity, unit_cost, total_cost, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(consumptionId, orderId, item.id, take.lot.id, take.lot.batchId, take.quantity, take.lot.unitCost, take.totalCost, at),
      );
    }
  }
  return { actual, totalCost, statements };
}

export function actorCanAccessSite(actor: Actor, siteId: string) {
  return Boolean(actor.scope?.isGlobal || actor.scope?.siteIds.includes(siteId));
}

export async function refreshSupplyChainAlerts(database: RuntimeDatabase, now = new Date().toISOString()) {
  const expiringAt = new Date(new Date(now).getTime() + 24 * 60 * 60_000).toISOString();
  const [sites, expiringLots, overLimitAccounts] = await Promise.all([
    queryRows<{ id: string }>(database.prepare("SELECT id FROM operation_sites WHERE status = 'open'")),
    queryRows<{ id: string; siteId: string; productSku: string; expiresAt: string }>(database.prepare(`SELECT id, site_id, product_sku, expires_at FROM site_stock_lots
      WHERE status = 'available' AND quantity > 0 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`).bind(now, expiringAt)),
    queryRows<{ id: string; siteId: string; balance: number; creditLimit: number }>(database.prepare(`SELECT id, site_id, balance, credit_limit FROM internal_accounts
      WHERE credit_limit > 0 AND balance > credit_limit`)),
  ]);
  const lowStocks = (await replenishmentSuggestions(database, sites.map((site) => site.id))).filter((row) => row.suggestedQuantity > 0);
  const statements: RuntimePreparedStatement[] = [];
  for (const row of lowStocks) {
    const id = `supply-low-${row.siteId}-${row.productSku}`;
    statements.push(database.prepare(`INSERT OR IGNORE INTO operation_alerts
      (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'warning', 'low-stock', ?, ?, 'open', 'store-owner', 'catalog-stock', ?, ?, ?)`)
      .bind(id, `Tồn ${row.productSku} đã chạm mức giữ`, `Còn ${row.onHand} phần; cần tạo phiếu điều chuyển.`, `${row.siteId}:${row.productSku}`, now, now));
  }
  for (const row of expiringLots) {
    const id = `supply-expiry-${row.id}`;
    statements.push(database.prepare(`INSERT OR IGNORE INTO operation_alerts
      (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'warning', 'lot-expiry', ?, ?, 'open', 'store-owner', 'stock-lot', ?, ?, ?)`)
      .bind(id, `Lô ${row.productSku} sắp hết hạn`, `Hạn dùng ${row.expiresAt}; ưu tiên xuất theo FEFO.`, row.id, now, now));
  }
  for (const row of overLimitAccounts) {
    const id = `internal-credit-${row.siteId}`;
    statements.push(database.prepare(`INSERT OR IGNORE INTO operation_alerts
      (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'critical', 'internal-credit', ?, ?, 'open', 'owner', 'internal-account', ?, ?, ?)`)
      .bind(id, `Công nợ ${row.siteId} vượt hạn mức`, `Dư nợ ${row.balance}đ vượt hạn mức ${row.creditLimit}đ; phiếu mới bị chặn nếu không có ngoại lệ owner.`, row.id, now, now));
  }
  if (statements.length) await database.batch(statements);
  return { lowStockAlerts: lowStocks.length, expiringLotAlerts: expiringLots.length, creditLimitAlerts: overLimitAccounts.length };
}

export async function replenishmentSuggestions(database: RuntimeDatabase, siteIds: readonly string[], reserveDays = 3) {
  if (!siteIds.length) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const placeholders = siteIds.map(() => "?").join(",");
  const rows = await queryRows<{ siteId: string; productSku: string; onHand: number; sold7d: number }>(database.prepare(`SELECT s.site_id, s.product_sku, s.on_hand,
      COALESCE((SELECT SUM(i.quantity) FROM operation_order_items i JOIN operation_orders o ON o.id = i.order_id
        WHERE o.site_id = s.site_id AND i.product_code = s.product_sku AND o.order_status = 'delivered' AND o.completed_at >= ?), 0) AS sold_7d
      FROM catalog_site_stock s WHERE s.track_stock = 1 AND s.site_id IN (${placeholders})
      ORDER BY s.site_id, s.product_sku`).bind(since, ...siteIds));
  return rows.map((row) => {
    const dailyVelocity = Number(row.sold7d) / 7;
    return { ...row, dailyVelocity, reserveDays, suggestedQuantity: Math.max(0, Math.ceil(dailyVelocity * reserveDays - Number(row.onHand))) };
  });
}
