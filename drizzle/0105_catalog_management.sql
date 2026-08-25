-- M3: nội dung thực đơn, giá theo phạm vi và giá điều chuyển.

ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS ingredients TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS allergens TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS nutrition_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS serving TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS prep_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS reward_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN IF NOT EXISTS sweetness_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS catalog_price_overrides (
  id TEXT PRIMARY KEY,
  product_sku TEXT NOT NULL REFERENCES catalog_products(sku),
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT catalog_price_scope_valid CHECK (scope_type IN ('site', 'site_kind', 'channel'))
);
CREATE INDEX IF NOT EXISTS price_override_lookup_idx
  ON catalog_price_overrides (product_sku, scope_type, scope_value, effective_from);

CREATE TABLE IF NOT EXISTS catalog_price_history (
  id TEXT PRIMARY KEY,
  product_sku TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  old_price INTEGER,
  new_price INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS catalog_price_history_product_idx
  ON catalog_price_history (product_sku, changed_at);

CREATE TABLE IF NOT EXISTS catalog_transfer_prices (
  id TEXT PRIMARY KEY,
  product_sku TEXT NOT NULL,
  site_kind TEXT NOT NULL,
  transfer_price INTEGER NOT NULL CHECK (transfer_price >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS catalog_transfer_price_lookup_idx
  ON catalog_transfer_prices (product_sku, site_kind, effective_from);
