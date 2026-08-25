-- M4: idempotency, sửa đơn, đặt trước, dine-in và tiến độ từng dòng món.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE IF NOT EXISTS order_amendments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES operation_orders(id),
  amendment_type TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  amount_delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_amendments_order_idx ON order_amendments (order_id, created_at);

CREATE TABLE IF NOT EXISTS order_payment_adjustments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES operation_orders(id),
  amendment_id TEXT NOT NULL REFERENCES order_amendments(id),
  direction TEXT NOT NULL CHECK (direction IN ('collect', 'refund')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS order_payment_adjustments_amendment_unique_idx ON order_payment_adjustments (amendment_id);

ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS scheduled_for TEXT;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS table_label TEXT NOT NULL DEFAULT '';
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS group_room_code TEXT;
ALTER TABLE operation_orders ADD COLUMN IF NOT EXISTS shift_id TEXT REFERENCES work_shifts(id);
CREATE INDEX IF NOT EXISTS operation_orders_schedule_idx ON operation_orders (site_id, scheduled_for, order_status);

ALTER TABLE operation_order_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE operation_order_items ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE operation_order_items ADD COLUMN IF NOT EXISTS done_at TEXT;
CREATE INDEX IF NOT EXISTS operation_order_items_kds_idx ON operation_order_items (status, order_id);

ALTER TABLE order_fulfillment_details DROP CONSTRAINT IF EXISTS order_fulfillment_type_valid;
ALTER TABLE order_fulfillment_details ADD CONSTRAINT order_fulfillment_type_valid
  CHECK (fulfillment_type IN ('delivery', 'pickup', 'dine-in'));

CREATE OR REPLACE FUNCTION operation_orders_integrity_check() RETURNS trigger AS $$
BEGIN
  IF (NEW.subtotal_amount < 0 OR NEW.delivery_fee_amount < 0 OR NEW.discount_amount < 0
      OR NEW.discount_amount > NEW.subtotal_amount + NEW.delivery_fee_amount
      OR NEW.total_amount != NEW.subtotal_amount + NEW.delivery_fee_amount - NEW.discount_amount
      OR NEW.item_count <= 0 OR NEW.currency != 'VND'
      OR NEW.fulfillment_type NOT IN ('delivery', 'pickup', 'dine-in')
      OR (NEW.fulfillment_type = 'dine-in' AND NEW.table_label = '')
      OR NEW.payment_method NOT IN ('bank_transfer', 'cash')
      OR NEW.source_environment NOT IN ('test', 'live')
      OR NEW.is_test != CASE WHEN NEW.source_environment = 'test' THEN 1 ELSE 0 END
      OR NEW.data_schema_version < 1) THEN
    RAISE EXCEPTION 'operation_orders_integrity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
