import type { RuntimeDatabase as D1Database } from "../db/runtime-database.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import { ensureCatalogSchema, loadCatalogForContext, resolvePrice } from "./catalog-store.ts";
import { operationEvent } from "./command-guards.ts";
import { eventStatement, queryRows } from "./operations-sql.ts";
import { assertEntityScope, siteIsInPortalScope, actorPolicy } from "./operations-snapshot.ts";
import { OperationsError, type Location } from "./operations-types.ts";
import type { CommandContext } from "./commands-orders.ts";

type ProductRow = {
  sku: string;
  name: string;
  category: string;
  basePrice: number;
  status: string;
  sortOrder: number;
  aliasesJson: string;
  description: string;
  note: string;
  ingredients: string;
  allergens: string;
  origin: string;
  nutritionJson: string;
  tagsJson: string;
  imageUrl: string;
  serving: string;
  prepMinutes: number;
  rewardPoints: number;
  sweetnessJson: string;
  updatedAt: string;
};

const categories = ["Chè", "Đồ uống", "Combo văn phòng", "Kiểm thử"] as const;

function jsonObject(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OperationsError(`Trường ${field} phải là object.`, 400, "invalid_json_object");
  return JSON.stringify(value);
}

function stringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new OperationsError(`Trường ${field} phải là mảng chuỗi.`, 400, "invalid_string_array");
  return JSON.stringify(value.map((item) => item.trim()).filter(Boolean).slice(0, 30));
}

function productSku(data: Record<string, unknown>) {
  const sku = readString(data, "sku").toLocaleUpperCase("en-US");
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(sku)) throw new OperationsError("SKU không hợp lệ.", 400, "invalid_sku");
  return sku;
}

async function scopedSite(d1: D1Database, actor: CommandContext["actor"], siteId: string) {
  const rows = await queryRows<Location>(d1.prepare("SELECT * FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId));
  if (!rows[0]) throw new OperationsError("Không tìm thấy điểm bán.", 404, "site_not_found");
  assertEntityScope(actor, siteIsInPortalScope(actorPolicy(actor), rows[0].id), "điểm bán");
  return rows[0];
}

export async function handleCatalogCommands(d1: D1Database, context: CommandContext) {
  const { command, actor, data, now } = context;
  if (!command.startsWith("catalog.")) return null;
  await ensureCatalogSchema(d1);
  const changedBy = actor.userId || actor.name;

  if (command === "catalog.product.create") {
    const sku = productSku(data);
    const name = boundedText(data, "name", 160);
    const category = readString(data, "category") as (typeof categories)[number];
    if (!categories.includes(category)) throw new OperationsError("Nhóm món không hợp lệ.", 400, "invalid_category");
    const basePrice = readInteger(data, "basePrice", { min: 0, max: 100_000_000 });
    const aliasesJson = stringArray(data.aliases, "aliases") || "[]";
    const nutritionJson = jsonObject(data.nutrition, "nutrition") || "{}";
    const tagsJson = stringArray(data.tags, "tags") || "[]";
    const sweetnessJson = stringArray(data.sweetness, "sweetness") || "[]";
    const event = operationEvent("catalog-product", sku, command, actor, null, "active", { basePrice });
    try {
      await d1.batch([
        d1.prepare(`INSERT INTO catalog_products
          (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order,
           description, note, ingredients, allergens, origin, nutrition_json, tags_json, image_url,
           serving, prep_minutes, reward_points, sweetness_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'VND', ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(sku, name, category, basePrice, aliasesJson, data.testOnly === true ? 1 : 0,
            readInteger(data, "sortOrder", { min: 0, max: 1_000_000, required: false }),
            boundedText(data, "description", 2000, false), boundedText(data, "note", 1000, false),
            boundedText(data, "ingredients", 2000, false), boundedText(data, "allergens", 1000, false),
            boundedText(data, "origin", 500, false), nutritionJson, tagsJson,
            boundedText(data, "imageUrl", 1000, false), boundedText(data, "serving", 200, false),
            readInteger(data, "prepMinutes", { min: 0, max: 1440, required: false }),
            readInteger(data, "rewardPoints", { min: 0, max: 1_000_000, required: false }),
            sweetnessJson, now, now),
        eventStatement(d1, event),
      ]);
    } catch (error) {
      if (String(error).toLocaleLowerCase("en-US").includes("unique")) throw new OperationsError("SKU đã tồn tại.", 409, "catalog_product_exists");
      throw error;
    }
    return { command, sku };
  }

  if (command === "catalog.product.update") {
    const sku = productSku(data);
    const rows = await queryRows<ProductRow>(d1.prepare("SELECT * FROM catalog_products WHERE sku = ? LIMIT 1").bind(sku));
    const current = rows[0];
    if (!current) throw new OperationsError("Không tìm thấy món.", 404, "catalog_product_not_found");
    const category = readString(data, "category", false) || current.category;
    if (!categories.includes(category as (typeof categories)[number])) throw new OperationsError("Nhóm món không hợp lệ.", 400, "invalid_category");
    const nextPrice = data.basePrice === undefined ? Number(current.basePrice) : readInteger(data, "basePrice", { min: 0, max: 100_000_000 });
    const event = operationEvent("catalog-product", sku, command, actor, current.status, current.status, { oldPrice: current.basePrice, newPrice: nextPrice });
    const result = await d1.batch([
      d1.prepare(`UPDATE catalog_products SET name = ?, category = ?, base_price = ?, aliases_json = ?, sort_order = ?,
        description = ?, note = ?, ingredients = ?, allergens = ?, origin = ?, nutrition_json = ?, tags_json = ?,
        image_url = ?, serving = ?, prep_minutes = ?, reward_points = ?, sweetness_json = ?, updated_at = ?
        WHERE sku = ? AND updated_at = ?`)
        .bind(readString(data, "name", false) || current.name, category, nextPrice,
          stringArray(data.aliases, "aliases") ?? current.aliasesJson,
          data.sortOrder === undefined ? Number(current.sortOrder) : readInteger(data, "sortOrder", { min: 0, max: 1_000_000 }),
          data.description === undefined ? current.description : boundedText(data, "description", 2000, false),
          data.note === undefined ? current.note : boundedText(data, "note", 1000, false),
          data.ingredients === undefined ? current.ingredients : boundedText(data, "ingredients", 2000, false),
          data.allergens === undefined ? current.allergens : boundedText(data, "allergens", 1000, false),
          data.origin === undefined ? current.origin : boundedText(data, "origin", 500, false),
          jsonObject(data.nutrition, "nutrition") ?? current.nutritionJson,
          stringArray(data.tags, "tags") ?? current.tagsJson,
          data.imageUrl === undefined ? current.imageUrl : boundedText(data, "imageUrl", 1000, false),
          data.serving === undefined ? current.serving : boundedText(data, "serving", 200, false),
          data.prepMinutes === undefined ? Number(current.prepMinutes) : readInteger(data, "prepMinutes", { min: 0, max: 1440 }),
          data.rewardPoints === undefined ? Number(current.rewardPoints) : readInteger(data, "rewardPoints", { min: 0, max: 1_000_000 }),
          stringArray(data.sweetness, "sweetness") ?? current.sweetnessJson,
          now, sku, current.updatedAt),
      eventStatement(d1, event),
    ]);
    if (result[0].meta.changes !== 1) throw new OperationsError("Món vừa được cập nhật ở phiên khác.", 409, "catalog_update_conflict");
    return { command, sku };
  }

  if (command === "catalog.product.archive") {
    const sku = productSku(data);
    const write = await d1.prepare("UPDATE catalog_products SET status = 'archived', updated_at = ? WHERE sku = ? AND status = 'active'").bind(now, sku).run();
    if (write.meta.changes !== 1) throw new OperationsError("Không tìm thấy món đang hoạt động.", 404, "catalog_product_not_found");
    return { command, sku, status: "archived" };
  }

  if (command === "catalog.option.upsert") {
    const sku = productSku(data);
    const code = readString(data, "code").toLocaleUpperCase("en-US");
    if (!/^[A-Z0-9][A-Z0-9._-]{1,79}$/.test(code)) throw new OperationsError("Mã tuỳ chọn không hợp lệ.", 400, "invalid_option_code");
    const exists = await queryRows<{ sku: string }>(d1.prepare("SELECT sku FROM catalog_products WHERE sku = ? AND status = 'active'").bind(sku));
    if (!exists[0]) throw new OperationsError("Không tìm thấy món.", 404, "catalog_product_not_found");
    await d1.prepare(`INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order, created_at, updated_at)
      VALUES (?, ?, 'topping', ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET product_sku = excluded.product_sku, name = excluded.name,
        price_delta = excluded.price_delta, status = 'active', sort_order = excluded.sort_order, updated_at = excluded.updated_at`)
      .bind(code, sku, boundedText(data, "name", 160), readInteger(data, "priceDelta", { min: 0, max: 10_000_000 }),
        readInteger(data, "sortOrder", { min: 0, max: 1_000_000, required: false }), now, now).run();
    return { command, sku, code };
  }

  if (command === "catalog.option.archive") {
    const code = readString(data, "code").toLocaleUpperCase("en-US");
    const write = await d1.prepare("UPDATE catalog_product_options SET status = 'archived', updated_at = ? WHERE code = ? AND status = 'active'").bind(now, code).run();
    if (write.meta.changes !== 1) throw new OperationsError("Không tìm thấy tuỳ chọn đang hoạt động.", 404, "catalog_option_not_found");
    return { command, code, status: "archived" };
  }

  if (command === "catalog.price.set") {
    const sku = productSku(data);
    const scopeType = readString(data, "scopeType") || "base";
    const allowed = ["base", "site", "site_kind", "channel"];
    if (!allowed.includes(scopeType)) throw new OperationsError("Phạm vi giá không hợp lệ.", 400, "invalid_price_scope");
    const scopeValue = scopeType === "base" ? "global" : readString(data, "scopeValue");
    if (scopeType === "site") await scopedSite(d1, actor, scopeValue);
    const price = readInteger(data, "price", { min: 0, max: 100_000_000 });
    const reason = boundedText(data, "reason", 500, false);
    const effectiveFrom = readIsoDate(data, "effectiveFrom", now);
    const effectiveTo = readString(data, "effectiveTo", false) ? readIsoDate(data, "effectiveTo") : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) throw new OperationsError("Thời gian kết thúc giá phải sau thời gian bắt đầu.", 400, "invalid_price_window");
    const oldPrice = scopeType === "base"
      ? await resolvePrice(d1, sku, { at: effectiveFrom })
      : await resolvePrice(d1, sku, scopeType === "site" ? { siteId: scopeValue, at: effectiveFrom } : scopeType === "site_kind" ? { siteKind: scopeValue, at: effectiveFrom } : scopeType === "channel" ? { channel: scopeValue, at: effectiveFrom } : { at: effectiveFrom });
    const id = crypto.randomUUID();
    const statements = scopeType === "base"
      ? [d1.prepare("UPDATE catalog_products SET base_price = ?, updated_at = ? WHERE sku = ? AND status = 'active'").bind(price, now, sku)]
      : [d1.prepare(`INSERT INTO catalog_price_overrides
          (id, product_sku, scope_type, scope_value, price, effective_from, effective_to, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, sku, scopeType, scopeValue, price, effectiveFrom, effectiveTo, changedBy, now)];
    const results = await d1.batch([
      ...statements,
      d1.prepare(`INSERT INTO catalog_price_history
        (id, product_sku, scope_type, scope_value, old_price, new_price, reason, changed_by, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), sku, scopeType, scopeValue, oldPrice, price, reason, changedBy, now),
    ]);
    if (scopeType === "base" && results[0].meta.changes !== 1) throw new OperationsError("Không tìm thấy món đang hoạt động.", 404, "catalog_product_not_found");
    return { command, sku, scopeType, scopeValue, oldPrice, price, effectiveFrom, effectiveTo };
  }

  if (command === "catalog.transfer-price.set") {
    const sku = productSku(data);
    const siteKind = boundedText(data, "siteKind", 80);
    const transferPrice = readInteger(data, "transferPrice", { min: 0, max: 100_000_000 });
    const effectiveFrom = readIsoDate(data, "effectiveFrom", now);
    const effectiveTo = readString(data, "effectiveTo", false) ? readIsoDate(data, "effectiveTo") : null;
    await d1.prepare(`INSERT INTO catalog_transfer_prices
      (id, product_sku, site_kind, transfer_price, effective_from, effective_to, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), sku, siteKind, transferPrice, effectiveFrom, effectiveTo, changedBy, now).run();
    return { command, sku, siteKind, transferPrice };
  }

  if (command === "catalog.site-stock.upsert") {
    const sku = productSku(data);
    const siteId = readString(data, "siteId");
    await scopedSite(d1, actor, siteId);
    const onHand = readInteger(data, "onHand", { min: 0, max: 10_000_000 });
    const reserved = readInteger(data, "reserved", { min: 0, max: onHand, required: false });
    const status = readString(data, "status", false) || "available";
    if (!['available', 'unavailable'].includes(status)) throw new OperationsError("Trạng thái tồn món không hợp lệ.", 400, "invalid_stock_status");
    await d1.prepare(`INSERT INTO catalog_site_stock (id, site_id, product_sku, on_hand, reserved, track_stock, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, product_sku) DO UPDATE SET on_hand = excluded.on_hand, reserved = excluded.reserved,
        track_stock = excluded.track_stock, status = excluded.status, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), siteId, sku, onHand, reserved, data.trackStock === false ? 0 : 1, status, now).run();
    return { command, sku, siteId, onHand, reserved, status };
  }

  return null;
}
