-- M8: hoàn tiền một phần, quỹ ca, COD và đối soát sao kê.

DROP INDEX IF EXISTS payment_refunds_order_unique_idx;
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx ON payment_refunds (order_id, created_at);

ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS site_id TEXT;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS payer_label TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS refund_type TEXT NOT NULL DEFAULT 'full';

UPDATE payment_attempts p
SET site_id = o.site_id
FROM operation_orders o
WHERE p.order_id = o.id AND p.site_id IS NULL;

CREATE INDEX IF NOT EXISTS payment_attempts_site_idx
  ON payment_attempts (site_id, created_at);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT REFERENCES work_shifts(id),
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  movement_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  order_id TEXT REFERENCES operation_orders(id),
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  remitted_at TEXT,
  remitted_shift_id TEXT REFERENCES work_shifts(id),
  created_at TEXT NOT NULL,
  CONSTRAINT cash_movements_type_valid CHECK (movement_type IN ('sale','refund','drop','float_in','payout','correction')),
  CONSTRAINT cash_movements_amount_valid CHECK (amount != 0)
);
CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON cash_movements (shift_id, created_at);
CREATE INDEX IF NOT EXISTS cash_movements_actor_idx ON cash_movements (actor_user_id, remitted_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_order_sale_unique_idx
  ON cash_movements (order_id) WHERE movement_type = 'sale' AND order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id TEXT PRIMARY KEY,
  statement_date TEXT NOT NULL,
  account_number TEXT NOT NULL,
  opening_balance INTEGER NOT NULL,
  closing_balance INTEGER NOT NULL,
  matched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  reconciled_by TEXT,
  reconciled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bank_reconciliations_date_idx
  ON bank_reconciliations (statement_date, account_number, created_at);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES bank_reconciliations(id),
  provider_transaction_id TEXT NOT NULL DEFAULT '',
  transaction_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  payment_code TEXT NOT NULL DEFAULT '',
  match_status TEXT NOT NULL,
  payment_transaction_id TEXT REFERENCES payment_transactions(id),
  source_type TEXT NOT NULL DEFAULT 'statement',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bank_statement_lines_reconciliation_idx
  ON bank_statement_lines (reconciliation_id, match_status, transaction_date);
