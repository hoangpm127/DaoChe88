import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { schemaIsManagedByMigrations } from "../db/runtime-database.ts";
// `with { type: "json" }` là bắt buộc với trình nạp ESM của Node (test chạy
// trực tiếp từ mã nguồn); bundler vốn đã chấp nhận cả hai cách.
import catalogSeed from "../data/seed/catalog-products.json" with { type: "json" };

export type CatalogOption = {
  code: string;
  kind: "topping";
  name: string;
  priceDelta: number;
  sortOrder: number;
};

export type CatalogProduct = {
  sku: string;
  name: string;
  category: "Chè" | "Đồ uống" | "Combo văn phòng" | "Kiểm thử";
  price: number;
  aliases: readonly string[];
  testOnly?: boolean;
  sortOrder: number;
  options: readonly CatalogOption[];
  description: string;
  note: string;
  ingredients: string;
  allergens: string;
  origin: string;
  nutrition: Record<string, string | number>;
  tags: readonly string[];
  imageUrl: string;
  serving: string;
  prepMinutes: number;
  rewardPoints: number;
  sweetness: readonly string[];
};

function options(productSku: string, entries: ReadonlyArray<readonly [string, number]>): CatalogOption[] {
  return entries.map(([name, priceDelta], index) => ({
    code: `${productSku}.TOPPING.${index + 1}`,
    kind: "topping",
    name,
    priceDelta,
    sortOrder: index + 1,
  }));
}

/**
 * Canonical bootstrap catalog. On a fresh database these rows are inserted once;
 * afterwards the database is authoritative so future admin price changes are not
 * overwritten by a deployment.
 */
type BootstrapCatalogProduct = Omit<CatalogProduct, "description" | "note" | "ingredients" | "allergens" | "origin" | "nutrition" | "tags" | "imageUrl" | "serving" | "prepMinutes" | "rewardPoints" | "sweetness"> & Partial<Pick<CatalogProduct, "description" | "note" | "ingredients" | "allergens" | "origin" | "nutrition" | "tags" | "imageUrl" | "serving" | "prepMinutes" | "rewardPoints" | "sweetness">>;

export function normalizeCatalogProduct(product: BootstrapCatalogProduct): CatalogProduct {
  return {
    ...product,
    description: product.description || "",
    note: product.note || "",
    ingredients: product.ingredients || "",
    allergens: product.allergens || "",
    origin: product.origin || "",
    nutrition: product.nutrition || {},
    tags: product.tags || [],
    imageUrl: product.imageUrl || "",
    serving: product.serving || "",
    prepMinutes: product.prepMinutes || 0,
    rewardPoints: product.rewardPoints || 0,
    sweetness: product.sweetness || [],
  };
}

const CATALOG_IDENTITIES: readonly BootstrapCatalogProduct[] = [
  { sku: "DC-BUOI", name: "Chè bưởi Năm Roi", category: "Chè", price: 28_000, aliases: ["DC-CHEBUOI"], sortOrder: 10, options: options("DC-BUOI", [["Trân châu trắng", 5_000], ["Cốt dừa thêm", 7_000], ["Đậu xanh thêm", 6_000]]) },
  { sku: "DC-KHUCBACH", name: "Chè khúc bạch nhãn", category: "Chè", price: 34_000, aliases: ["DC-KB"], sortOrder: 20, options: options("DC-KHUCBACH", [["Khúc bạch thêm", 10_000], ["Long nhãn", 9_000], ["Hạnh nhân lát", 6_000]]) },
  { sku: "DC-SAURIENG", name: "Chè Thái sầu riêng", category: "Chè", price: 39_000, aliases: ["DC-SR"], sortOrder: 30, options: options("DC-SAURIENG", [["Sầu riêng thêm", 12_000], ["Thạch lá dứa", 6_000], ["Mít thái sợi", 7_000]]) },
  { sku: "DC-KHOAIDEO", name: "Chè khoai dẻo ngũ sắc", category: "Chè", price: 32_000, aliases: ["DC-KD"], sortOrder: 40, options: options("DC-KHOAIDEO", [["Khoai dẻo thêm", 8_000], ["Trân châu trắng", 5_000], ["Cốt dừa thêm", 7_000]]) },
  { sku: "DC-DUADAM", name: "Chè dừa dầm Hải Phòng", category: "Chè", price: 30_000, aliases: ["DC-DD"], sortOrder: 50, options: options("DC-DUADAM", [["Cùi dừa thêm", 8_000], ["Thạch dừa", 6_000], ["Sữa dừa gấp đôi", 7_000]]) },
  { sku: "DC-DAUXANH", name: "Chè đậu xanh cốt dừa", category: "Chè", price: 22_000, aliases: [], sortOrder: 60, options: options("DC-DAUXANH", [["Phổ tai thêm", 5_000], ["Cốt dừa thêm", 7_000]]) },
  { sku: "DC-SENNHAN", name: "Chè hạt sen long nhãn", category: "Chè", price: 32_000, aliases: [], sortOrder: 70, options: options("DC-SENNHAN", [["Hạt sen thêm", 9_000], ["Long nhãn", 10_000], ["Thạch quế hoa", 7_000]]) },
  { sku: "DC-THAPCAM", name: "Chè thập cẩm Đảo Chè", category: "Chè", price: 30_000, aliases: [], sortOrder: 80, options: options("DC-THAPCAM", [["Thêm 3 topping", 9_000], ["Sầu riêng", 12_000], ["Cốt dừa thêm", 7_000]]) },
  { sku: "DC-SUONGSAO", name: "Chè sương sáo lá dứa", category: "Chè", price: 20_000, aliases: [], sortOrder: 90, options: options("DC-SUONGSAO", [["Sương sáo thêm", 5_000], ["Thạch lá dứa", 6_000]]) },
  { sku: "DC-TROINUOC", name: "Chè trôi nước gừng", category: "Chè", price: 25_000, aliases: [], sortOrder: 100, options: options("DC-TROINUOC", [["Viên trôi thêm", 7_000], ["Vừng rang", 4_000]]) },
  { sku: "DC-BAPCOT", name: "Chè bắp cốt dừa", category: "Chè", price: 24_000, aliases: ["DC-CHEBAP"], sortOrder: 110, options: options("DC-BAPCOT", [["Bắp thêm", 6_000], ["Dừa nạo", 5_000]]) },
  { sku: "DC-MATCHA", name: "Matcha latte sữa dừa", category: "Đồ uống", price: 39_000, aliases: [], sortOrder: 200, options: options("DC-MATCHA", [["Foam dừa", 9_000], ["Thạch matcha", 7_000], ["Shot matcha", 12_000]]) },
  { sku: "DC-SENLANEP", name: "Sữa sen lá nếp", category: "Đồ uống", price: 32_000, aliases: ["DC-SEN"], sortOrder: 210, options: options("DC-SENLANEP", [["Hạt sen", 8_000], ["Thạch lá dứa", 6_000]]) },
  { sku: "DC-CB-10", name: "Combo giữa giờ 10 phần", category: "Combo văn phòng", price: 259_000, aliases: [], sortOrder: 300, options: options("DC-CB-10", [["Thêm 2 phần", 52_000], ["Túi giữ lạnh", 15_000], ["Bộ thìa giấy", 0]]) },
  { sku: "DC-CB-20", name: "Combo cả tầng 20 phần", category: "Combo văn phòng", price: 498_000, aliases: [], sortOrder: 310, options: options("DC-CB-20", [["Thêm 5 phần", 120_000], ["Khung giờ ưu tiên", 20_000], ["Bộ thìa giấy", 0]]) },
  { sku: "TEST-SEPAY-2K", name: "Kiểm thử webhook SePay 2.000đ", category: "Kiểm thử", price: 2_000, aliases: [], testOnly: true, sortOrder: 9_999, options: [] },
] as const;

type CatalogSeedRow = {
  sku: string;
  /** Có trong tệp mồi và cần cho seedCatalogContent; BOOTSTRAP_CATALOG lấy định danh từ CATALOG_IDENTITIES. */
  name: string;
  category: CatalogProduct["category"];
  basePrice: number;
  sortOrder?: number;
  description: string;
  note: string;
  ingredients: string;
  allergens: string;
  origin: string;
  nutrition: Record<string, string | number>;
  tags: string[];
  imageUrl: string;
  serving: string;
  prepMinutes: number;
  rewardPoints: number;
  sweetness: string[];
};

const seedContentBySku = new Map((catalogSeed as CatalogSeedRow[]).map((product) => [product.sku, product]));

export const BOOTSTRAP_CATALOG: readonly BootstrapCatalogProduct[] = CATALOG_IDENTITIES.map((product) => {
  const content = seedContentBySku.get(product.sku);
  return content ? {
    ...product,
    description: content.description,
    note: content.note,
    ingredients: content.ingredients,
    allergens: content.allergens,
    origin: content.origin,
    nutrition: content.nutrition,
    tags: content.tags,
    imageUrl: content.imageUrl,
    serving: content.serving,
    prepMinutes: content.prepMinutes,
    rewardPoints: content.rewardPoints,
    sweetness: content.sweetness,
  } : product;
});

type ProductRow = {
  sku: string;
  name: string;
  category: CatalogProduct["category"];
  basePrice: number;
  aliasesJson: string;
  testOnly: number | boolean;
  sortOrder: number;
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
};

type OptionRow = {
  code: string;
  productSku: string;
  kind: "topping";
  name: string;
  priceDelta: number;
  sortOrder: number;
};

export type CatalogSiteAvailability = {
  siteId: string;
  productSku: string;
  onHand: number;
  reserved: number;
  available: number | null;
  trackStock: boolean;
  status: string;
  updatedAt: string;
};

const readyDatabases = new WeakSet<object>();

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseRecord(value: string): Record<string, string | number> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"));
  } catch {
    return {};
  }
}

function camelRows<T>(rows: Record<string, unknown>[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])) as T);
}

export function findCatalogProduct(catalog: readonly CatalogProduct[], suppliedCode: string) {
  const code = suppliedCode.trim().toLocaleUpperCase("en-US");
  return catalog.find((product) => product.sku === code || product.aliases.some((alias) => alias === code));
}

export async function ensureCatalogSchema(_database: RuntimeDatabase) {
  // VỎ RỖNG CÓ CHỦ ĐÍCH — schema do migration trong `drizzle/` sở hữu.
  //
  // Thân hàm cũ là bản định nghĩa schema THỨ HAI, dựng bảng ngay trong đường
  // chạy request cho adapter SQLite. Adapter đó đã được gỡ, nên phần đó là mã
  // chết: nó không chạy, nhưng vẫn lệch dần so với drizzle/ và đánh lừa người
  // đọc rằng có hai nguồn sự thật.
  //
  // Giữ lại vỏ hàm để các chỗ gọi không phải sửa cùng lúc.
  return _database;
}

/**
 * Nạp NỘI DUNG món (mô tả, thành phần, dị ứng, ảnh, điểm thưởng) từ tệp mồi.
 *
 * ==========================================================================
 * VÌ SAO TÁCH RA
 * ==========================================================================
 * Migration `drizzle/0101_catalog_bootstrap.sql` chỉ chèn phần ĐỊNH DANH của
 * món: sku, tên, nhóm, giá gốc. Không có một cột nội dung nào.
 *
 * Phần nội dung trước đây chỉ được áp bên trong `ensureCatalogSchema`, mà hàm
 * đó `return` sớm trên PostgreSQL. Hệ quả trên production (đo ngày 2026-08-23):
 * 13/13 món có tên và giá nhưng mô tả, ảnh, thành phần, dị ứng và điểm thưởng
 * đều rỗng.
 *
 * Dùng ON CONFLICT DO UPDATE chứ không phải DO NOTHING: hàng định danh đã tồn
 * tại sẵn từ migration, nên DO NOTHING sẽ bỏ qua và nội dung mãi mãi rỗng —
 * đúng cái đang xảy ra trên production.
 */
export async function seedCatalogContent(database: RuntimeDatabase) {
  const now = new Date().toISOString();
  await database.batch((catalogSeed as CatalogSeedRow[]).map((product) => database.prepare(
    `INSERT INTO catalog_products (
       sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order,
       description, note, ingredients, allergens, origin, nutrition_json, tags_json, image_url,
       serving, prep_minutes, reward_points, sweetness_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'VND', '[]', 'active', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (sku) DO UPDATE SET
       name = excluded.name, category = excluded.category, description = excluded.description,
       note = excluded.note, ingredients = excluded.ingredients, allergens = excluded.allergens,
       origin = excluded.origin, nutrition_json = excluded.nutrition_json, tags_json = excluded.tags_json,
       image_url = excluded.image_url, serving = excluded.serving, prep_minutes = excluded.prep_minutes,
       reward_points = excluded.reward_points, sweetness_json = excluded.sweetness_json,
       sort_order = excluded.sort_order, updated_at = excluded.updated_at`,
  ).bind(
    product.sku, product.name, product.category, product.basePrice, product.sortOrder || 0,
    product.description || "", product.note || "", product.ingredients || "", product.allergens || "",
    product.origin || "", JSON.stringify(product.nutrition || {}), JSON.stringify(product.tags || []),
    product.imageUrl || "", product.serving || "", product.prepMinutes || 0, product.rewardPoints || 0,
    JSON.stringify(product.sweetness || []), now, now,
  )));
}

export async function loadCatalog(database: RuntimeDatabase): Promise<CatalogProduct[]> {
  await ensureCatalogSchema(database);
  const [productResult, optionResult] = await Promise.all([
    database.prepare(`SELECT sku, name, category, base_price, aliases_json, test_only, sort_order,
      description, note, ingredients, allergens, origin, nutrition_json, tags_json, image_url,
      serving, prep_minutes, reward_points, sweetness_json
      FROM catalog_products WHERE status = 'active' ORDER BY sort_order, name`).all<Record<string, unknown>>(),
    database.prepare("SELECT code, product_sku, kind, name, price_delta, sort_order FROM catalog_product_options WHERE status = 'active' ORDER BY product_sku, sort_order, name").all<Record<string, unknown>>(),
  ]);
  const productRows = camelRows<ProductRow>(productResult.results || []);
  const optionRows = camelRows<OptionRow>(optionResult.results || []);
  return productRows.map((product) => ({
    sku: product.sku,
    name: product.name,
    category: product.category,
    price: Number(product.basePrice),
    aliases: parseStringArray(product.aliasesJson),
    testOnly: product.testOnly === true || product.testOnly === 1,
    sortOrder: Number(product.sortOrder),
    options: optionRows
      .filter((option) => option.productSku === product.sku)
      .map((option) => ({ ...option, priceDelta: Number(option.priceDelta), sortOrder: Number(option.sortOrder) })),
    description: product.description || "",
    note: product.note || "",
    ingredients: product.ingredients || "",
    allergens: product.allergens || "",
    origin: product.origin || "",
    nutrition: parseRecord(product.nutritionJson || "{}"),
    tags: parseStringArray(product.tagsJson || "[]"),
    imageUrl: product.imageUrl || "",
    serving: product.serving || "",
    prepMinutes: Number(product.prepMinutes || 0),
    rewardPoints: Number(product.rewardPoints || 0),
    sweetness: parseStringArray(product.sweetnessJson || "[]"),
  }));
}

export type PriceContext = {
  siteId?: string;
  siteKind?: string;
  channel?: string;
  at?: string;
};

/** Resolve the authoritative sell price. Priority: site > site kind > channel > base. */
export async function resolvePrice(database: RuntimeDatabase, productSku: string, context: PriceContext = {}) {
  await ensureCatalogSchema(database);
  const at = context.at || new Date().toISOString();
  const siteId = context.siteId?.trim() || "";
  let siteKind = context.siteKind?.trim() || "";
  if (siteId) {
    const result = await database.prepare("SELECT kind FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId).all<Record<string, unknown>>();
    siteKind = String(result.results?.[0]?.kind || "");
  }
  const candidates: Array<readonly [string, string]> = [];
  if (siteId) candidates.push(["site", siteId]);
  if (siteKind) candidates.push(["site_kind", siteKind]);
  if (context.channel?.trim()) candidates.push(["channel", context.channel.trim()]);

  for (const [scopeType, scopeValue] of candidates) {
    const result = await database.prepare(`SELECT price FROM catalog_price_overrides
      WHERE product_sku = ? AND scope_type = ? AND scope_value = ?
        AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY effective_from DESC, created_at DESC LIMIT 1`)
      .bind(productSku, scopeType, scopeValue, at, at).all<Record<string, unknown>>();
    if (result.results?.[0]) return Number(result.results[0].price);
  }

  const base = await database.prepare("SELECT base_price FROM catalog_products WHERE sku = ? AND status = 'active' LIMIT 1")
    .bind(productSku).all<Record<string, unknown>>();
  if (!base.results?.[0]) throw new Error(`Unknown active catalog product: ${productSku}`);
  return Number(base.results[0].base_price);
}

export async function loadCatalogForContext(database: RuntimeDatabase, context: PriceContext = {}): Promise<CatalogProduct[]> {
  const catalog = await loadCatalog(database);
  return Promise.all(catalog.map(async (product) => ({
    ...product,
    price: await resolvePrice(database, product.sku, context),
  })));
}

export async function loadSiteAvailability(database: RuntimeDatabase, siteId: string): Promise<CatalogSiteAvailability[]> {
  await ensureCatalogSchema(database);
  const result = await database.prepare(`SELECT site_id, product_sku, on_hand, reserved, track_stock, status, updated_at
    FROM catalog_site_stock WHERE site_id = ?`).bind(siteId).all<Record<string, unknown>>();
  return camelRows<Omit<CatalogSiteAvailability, "available" | "trackStock"> & { trackStock: number | boolean }>(result.results || []).map((row) => ({
    ...row,
    onHand: Number(row.onHand),
    reserved: Number(row.reserved),
    available: row.trackStock === true || row.trackStock === 1 ? Math.max(0, Number(row.onHand) - Number(row.reserved)) : null,
    trackStock: row.trackStock === true || row.trackStock === 1,
  }));
}

export async function publicCatalog(database: RuntimeDatabase | null, options: { includeTest?: boolean; siteId?: string; channel?: string } = {}) {
  const catalog: readonly CatalogProduct[] = database
    ? await loadCatalogForContext(database, { siteId: options.siteId, channel: options.channel })
    : BOOTSTRAP_CATALOG.map(normalizeCatalogProduct);
  const availability = database && options.siteId ? await loadSiteAvailability(database, options.siteId) : [];
  const availabilityBySku = new Map(availability.map((row) => [row.productSku, row]));
  return catalog
    .filter((product) => options.includeTest || !product.testOnly)
    .map((product) => {
      const stock = availabilityBySku.get(product.sku);
      return {
        sku: product.sku,
        name: product.name,
        category: product.category,
        price: product.price,
        currency: "VND" as const,
        status: stock?.status === "unavailable" || (stock?.trackStock && stock.available === 0) ? "unavailable" as const : "available" as const,
        availableQuantity: stock?.available ?? null,
        description: product.description,
        note: product.note,
        ingredients: product.ingredients,
        allergens: product.allergens,
        origin: product.origin,
        nutrition: product.nutrition,
        tags: product.tags,
        imageUrl: product.imageUrl,
        serving: product.serving,
        prepMinutes: product.prepMinutes,
        rewardPoints: product.rewardPoints,
        sweetness: product.sweetness,
        options: product.options.map((option) => ({ code: option.code, kind: option.kind, name: option.name, priceDelta: option.priceDelta })),
      };
    });
}
