#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const file = fileURLToPath(new URL("../data/seed/catalog-products.json", import.meta.url));

function validate(product, index) {
  if (!product || typeof product !== "object") throw new Error(`Dòng ${index + 1}: sản phẩm không hợp lệ.`);
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(product.sku || "")) throw new Error(`Dòng ${index + 1}: SKU không hợp lệ.`);
  if (!product.name || !product.category) throw new Error(`Dòng ${index + 1}: thiếu tên/nhóm món.`);
  if (!Number.isInteger(product.basePrice) || product.basePrice < 0) throw new Error(`Dòng ${index + 1}: giá không hợp lệ.`);
  if (!Array.isArray(product.tags) || !Array.isArray(product.sweetness)) throw new Error(`Dòng ${index + 1}: tags/sweetness phải là mảng.`);
  return product;
}

async function main() {
  const products = JSON.parse(await readFile(file, "utf8")).map(validate);
  const duplicates = products.filter((product, index) => products.findIndex((row) => row.sku === product.sku) !== index);
  if (duplicates.length) throw new Error(`Trùng SKU: ${[...new Set(duplicates.map((row) => row.sku))].join(", ")}.`);
  if (process.argv.includes("--dry-run")) {
    console.log(`Đã kiểm tra ${products.length} món hợp lệ (dry-run).`);
    return;
  }
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("Thiếu DATABASE_URL.");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (transaction) => {
      for (const product of products) {
        const now = new Date().toISOString();
        await transaction`INSERT INTO catalog_products (
          sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order,
          description, note, ingredients, allergens, origin, nutrition_json, tags_json, image_url,
          serving, prep_minutes, reward_points, sweetness_json, created_at, updated_at
        ) VALUES (
          ${product.sku}, ${product.name}, ${product.category}, ${product.basePrice}, 'VND', '[]', 'active', 0, ${product.sortOrder || 0},
          ${product.description || ''}, ${product.note || ''}, ${product.ingredients || ''}, ${product.allergens || ''},
          ${product.origin || ''}, ${JSON.stringify(product.nutrition || {})}, ${JSON.stringify(product.tags || [])},
          ${product.imageUrl || ''}, ${product.serving || ''}, ${product.prepMinutes || 0}, ${product.rewardPoints || 0},
          ${JSON.stringify(product.sweetness || [])}, ${now}, ${now}
        ) ON CONFLICT (sku) DO UPDATE SET
          name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description,
          note = EXCLUDED.note, ingredients = EXCLUDED.ingredients, allergens = EXCLUDED.allergens,
          origin = EXCLUDED.origin, nutrition_json = EXCLUDED.nutrition_json, tags_json = EXCLUDED.tags_json,
          image_url = EXCLUDED.image_url, serving = EXCLUDED.serving, prep_minutes = EXCLUDED.prep_minutes,
          reward_points = EXCLUDED.reward_points, sweetness_json = EXCLUDED.sweetness_json,
          sort_order = EXCLUDED.sort_order, updated_at = EXCLUDED.updated_at`;
      }
    });
    console.log(`Đã nạp/cập nhật nội dung ${products.length} món. Giá hiện hành không bị ghi đè.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(`Import catalog thất bại: ${error?.message || error}`);
  process.exitCode = 1;
});
