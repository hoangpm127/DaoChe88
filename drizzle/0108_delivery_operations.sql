-- M9: phí giao theo khoảng cách, báo giá khóa, POD và vị trí shipper.

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS delivery_quote_id TEXT;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS delivery_distance_meters INTEGER;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS delivery_provider_preference TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS delivery_otp_code TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS operation_orders_delivery_quote_unique_idx
  ON operation_orders (delivery_quote_id) WHERE delivery_quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_fee_rules (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES operation_sites(id),
  rule_type TEXT NOT NULL,
  min_value INTEGER NOT NULL,
  max_value INTEGER,
  fee INTEGER NOT NULL,
  free_over_amount INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT delivery_fee_rules_type_valid CHECK (rule_type IN ('distance','order_value','time_window')),
  CONSTRAINT delivery_fee_rules_range_valid CHECK (min_value >= 0 AND (max_value IS NULL OR max_value >= min_value)),
  CONSTRAINT delivery_fee_rules_fee_valid CHECK (fee >= 0 AND (free_over_amount IS NULL OR free_over_amount >= 0))
);
CREATE INDEX IF NOT EXISTS delivery_fee_rules_active_idx
  ON delivery_fee_rules (site_id, rule_type, priority, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES operation_orders(id),
  proof_type TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'delivered',
  photo_url TEXT NOT NULL DEFAULT '',
  otp_verified INTEGER NOT NULL DEFAULT 0,
  recipient_name TEXT NOT NULL DEFAULT '',
  latitude_e6 INTEGER,
  longitude_e6 INTEGER,
  captured_by TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  CONSTRAINT delivery_proofs_type_valid CHECK (proof_type IN ('photo','otp','signature')),
  CONSTRAINT delivery_proofs_purpose_valid CHECK (purpose IN ('delivered','delivery_failed'))
);
CREATE INDEX IF NOT EXISTS delivery_proofs_order_idx ON delivery_proofs (order_id, captured_at);
CREATE INDEX IF NOT EXISTS delivery_proofs_retention_idx ON delivery_proofs (proof_type, captured_at);

CREATE TABLE IF NOT EXISTS shipper_locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT,
  latitude_e6 INTEGER NOT NULL,
  longitude_e6 INTEGER NOT NULL,
  accuracy_m INTEGER,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shipper_locations_idx ON shipper_locations (user_id, recorded_at);
CREATE INDEX IF NOT EXISTS shipper_locations_order_idx ON shipper_locations (order_id, recorded_at);

INSERT INTO delivery_fee_rules
  (id, site_id, rule_type, min_value, max_value, fee, free_over_amount, priority, effective_from, effective_to, created_by, created_at)
VALUES
  ('delivery-default-0-3km', NULL, 'distance', 0, 2999, 15000, 300000, 10, '2026-01-01T00:00:00.000Z', NULL, 'system', CURRENT_TIMESTAMP),
  ('delivery-default-3-7km', NULL, 'distance', 3000, 6999, 25000, 300000, 10, '2026-01-01T00:00:00.000Z', NULL, 'system', CURRENT_TIMESTAMP),
  ('delivery-default-7km-plus', NULL, 'distance', 7000, NULL, 35000, 300000, 10, '2026-01-01T00:00:00.000Z', NULL, 'system', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;
