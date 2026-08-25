-- M7: mua nguyên liệu, sản xuất, điều chuyển, FEFO, kiểm kê và hao hụt.

ALTER TABLE finance_order_allocations ADD COLUMN IF NOT EXISTS cost_source TEXT NOT NULL DEFAULT 'estimated';

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_code TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  status TEXT NOT NULL DEFAULT 'draft',
  ordered_at TEXT,
  expected_at TEXT,
  received_at TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0,
  vat_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_url TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT purchase_orders_status_valid CHECK (status IN ('draft','ordered','partially_received','received','cancelled'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  material_sku TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  CONSTRAINT purchase_order_items_values_valid CHECK (quantity_ordered > 0 AND quantity_received >= 0 AND quantity_received <= quantity_ordered AND unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx ON purchase_order_items (po_id, material_sku);

CREATE TABLE IF NOT EXISTS material_stock_lots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  material_sku TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id),
  purchase_order_item_id TEXT REFERENCES purchase_order_items(id),
  lot_code TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  expires_at TEXT,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  CONSTRAINT material_stock_lots_values_valid CHECK (quantity >= 0 AND unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS material_stock_lots_fefo_idx ON material_stock_lots (site_id, material_sku, status, expires_at, received_at);

CREATE TABLE IF NOT EXISTS material_stock_movements (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  material_sku TEXT NOT NULL,
  lot_id TEXT,
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS material_stock_movements_ref_idx ON material_stock_movements (reference_type, reference_id, created_at);

CREATE TABLE IF NOT EXISTS product_recipes (
  id TEXT PRIMARY KEY,
  product_sku TEXT NOT NULL REFERENCES catalog_products(sku),
  material_sku TEXT NOT NULL,
  quantity_per_unit INTEGER NOT NULL,
  unit TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT product_recipes_quantity_valid CHECK (quantity_per_unit > 0)
);
CREATE INDEX IF NOT EXISTS product_recipes_idx ON product_recipes (product_sku, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS production_batches (
  id TEXT PRIMARY KEY,
  batch_code TEXT NOT NULL UNIQUE,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  product_sku TEXT NOT NULL REFERENCES catalog_products(sku),
  planned_quantity INTEGER NOT NULL,
  produced_quantity INTEGER NOT NULL DEFAULT 0,
  rejected_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  material_cost INTEGER NOT NULL DEFAULT 0,
  labor_cost INTEGER NOT NULL DEFAULT 0,
  overhead_cost INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  produced_at TEXT,
  expires_at TEXT,
  quality_check_by TEXT,
  quality_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT production_batches_status_valid CHECK (status IN ('planned','in_progress','completed','cancelled')),
  CONSTRAINT production_batches_values_valid CHECK (planned_quantity > 0 AND produced_quantity >= 0 AND rejected_quantity >= 0 AND material_cost >= 0 AND labor_cost >= 0 AND overhead_cost >= 0 AND unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS production_batches_idx ON production_batches (product_sku, produced_at);
CREATE INDEX IF NOT EXISTS production_batches_expiry_idx ON production_batches (expires_at, status);

CREATE TABLE IF NOT EXISTS production_material_usage (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES production_batches(id),
  material_sku TEXT NOT NULL,
  material_lot_id TEXT REFERENCES material_stock_lots(id),
  quantity_used INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS production_material_usage_batch_idx ON production_material_usage (batch_id, material_sku);

CREATE TABLE IF NOT EXISTS site_stock_lots (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  product_sku TEXT NOT NULL,
  batch_id TEXT REFERENCES production_batches(id),
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  expires_at TEXT,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  CONSTRAINT site_stock_lots_values_valid CHECK (quantity >= 0 AND unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS site_stock_lots_fefo_idx ON site_stock_lots (site_id, product_sku, status, expires_at, received_at);

CREATE TABLE IF NOT EXISTS transfer_orders (
  id TEXT PRIMARY KEY,
  transfer_code TEXT NOT NULL UNIQUE,
  from_site_id TEXT NOT NULL REFERENCES operation_sites(id),
  to_site_id TEXT NOT NULL REFERENCES operation_sites(id),
  status TEXT NOT NULL DEFAULT 'requested',
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  packed_by TEXT,
  received_by TEXT,
  requested_at TEXT NOT NULL,
  approved_at TEXT,
  packed_at TEXT,
  shipped_at TEXT,
  received_at TEXT,
  transfer_value INTEGER NOT NULL DEFAULT 0,
  cost_value INTEGER NOT NULL DEFAULT 0,
  vehicle TEXT NOT NULL DEFAULT '',
  driver_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT transfer_orders_sites_valid CHECK (from_site_id <> to_site_id),
  CONSTRAINT transfer_orders_status_valid CHECK (status IN ('requested','approved','packed','in_transit','received','partially_received','rejected','cancelled'))
);
CREATE INDEX IF NOT EXISTS transfer_orders_to_site_idx ON transfer_orders (to_site_id, status, requested_at);
CREATE INDEX IF NOT EXISTS transfer_orders_from_site_idx ON transfer_orders (from_site_id, status, requested_at);

CREATE TABLE IF NOT EXISTS transfer_order_items (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfer_orders(id),
  product_sku TEXT NOT NULL,
  batch_id TEXT,
  quantity_requested INTEGER NOT NULL,
  quantity_shipped INTEGER NOT NULL DEFAULT 0,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  quantity_rejected INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT NOT NULL DEFAULT '',
  transfer_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  expires_at TEXT,
  CONSTRAINT transfer_order_items_values_valid CHECK (quantity_requested > 0 AND quantity_shipped >= 0 AND quantity_received >= 0 AND quantity_rejected >= 0 AND transfer_price >= 0 AND unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS transfer_order_items_transfer_idx ON transfer_order_items (transfer_id, product_sku);

CREATE TABLE IF NOT EXISTS transfer_item_lots (
  id TEXT PRIMARY KEY,
  transfer_item_id TEXT NOT NULL REFERENCES transfer_order_items(id),
  source_lot_id TEXT NOT NULL REFERENCES site_stock_lots(id),
  batch_id TEXT,
  quantity_shipped INTEGER NOT NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL,
  expires_at TEXT,
  CONSTRAINT transfer_item_lots_values_valid CHECK (quantity_shipped > 0 AND quantity_received >= 0 AND quantity_received <= quantity_shipped)
);
CREATE INDEX IF NOT EXISTS transfer_item_lots_item_idx ON transfer_item_lots (transfer_item_id, source_lot_id);

CREATE TABLE IF NOT EXISTS transfer_discrepancies (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES transfer_orders(id),
  transfer_item_id TEXT NOT NULL REFERENCES transfer_order_items(id),
  missing_quantity INTEGER NOT NULL DEFAULT 0,
  damaged_quantity INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS order_item_lot_consumptions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES operation_orders(id),
  order_item_id TEXT NOT NULL REFERENCES operation_order_items(id),
  site_stock_lot_id TEXT NOT NULL REFERENCES site_stock_lots(id),
  batch_id TEXT,
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT order_item_lot_consumptions_values_valid CHECK (quantity > 0 AND unit_cost >= 0 AND total_cost >= 0)
);
CREATE INDEX IF NOT EXISTS order_item_lot_order_idx ON order_item_lot_consumptions (order_id, order_item_id);

CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  count_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  counted_by TEXT NOT NULL,
  approved_by TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  variance_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  CONSTRAINT stock_counts_type_valid CHECK (count_type IN ('shift_close','daily','monthly','spot')),
  CONSTRAINT stock_counts_status_valid CHECK (status IN ('open','submitted','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS stock_counts_site_idx ON stock_counts (site_id, status, started_at);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES stock_counts(id),
  product_sku TEXT NOT NULL,
  system_quantity INTEGER NOT NULL,
  counted_quantity INTEGER NOT NULL,
  variance INTEGER NOT NULL,
  variance_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS stock_count_items_count_idx ON stock_count_items (count_id, product_sku);

CREATE TABLE IF NOT EXISTS waste_records (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  product_sku TEXT,
  material_sku TEXT,
  batch_id TEXT,
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  reason TEXT NOT NULL,
  photo_url TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT waste_records_reason_valid CHECK (reason IN ('expired','damaged','quality','customer_return','theft','count_variance')),
  CONSTRAINT waste_records_values_valid CHECK (quantity > 0 AND unit_cost >= 0 AND total_cost >= 0)
);
CREATE INDEX IF NOT EXISTS waste_records_site_idx ON waste_records (site_id, created_at, reason);
