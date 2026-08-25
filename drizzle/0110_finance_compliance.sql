-- M10: công nợ nội bộ, kỳ kế toán, đối soát tự tính và hóa đơn hoãn.

CREATE TABLE IF NOT EXISTS internal_accounts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES operation_sites(id) UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,
  credit_limit INTEGER NOT NULL DEFAULT 0,
  last_settled_at TEXT,
  updated_at TEXT NOT NULL,
  CONSTRAINT internal_accounts_values_valid CHECK (balance >= 0 AND credit_limit >= 0)
);

CREATE TABLE IF NOT EXISTS internal_account_entries (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  transfer_id TEXT REFERENCES transfer_orders(id),
  payment_reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT internal_account_entries_type_valid CHECK (entry_type IN ('transfer','payment','adjustment')),
  CONSTRAINT internal_account_entries_balance_valid CHECK (balance_after >= 0)
);
CREATE INDEX IF NOT EXISTS internal_account_entries_site_idx ON internal_account_entries (site_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS internal_account_transfer_unique_idx ON internal_account_entries (transfer_id) WHERE transfer_id IS NOT NULL AND entry_type = 'transfer';

CREATE TABLE IF NOT EXISTS accounting_periods (
  id TEXT PRIMARY KEY,
  period_code TEXT NOT NULL UNIQUE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_by TEXT,
  closed_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT accounting_periods_status_valid CHECK (status IN ('open','closing','closed'))
);

CREATE TABLE IF NOT EXISTS finance_settlement_lines (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES finance_settlements(id),
  ledger_entry_id TEXT NOT NULL REFERENCES finance_ledger_entries(id),
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_settlement_line_ledger_unique_idx ON finance_settlement_lines (ledger_entry_id);
CREATE INDEX IF NOT EXISTS finance_settlement_lines_settlement_idx ON finance_settlement_lines (settlement_id);

CREATE TABLE IF NOT EXISTS einvoices (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES operation_orders(id) UNIQUE,
  provider TEXT NOT NULL,
  invoice_number TEXT,
  invoice_series TEXT,
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_tax_code TEXT NOT NULL DEFAULT '',
  buyer_address TEXT NOT NULL DEFAULT '',
  buyer_email TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  vat_rate_bps INTEGER NOT NULL,
  vat_amount INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_payload TEXT NOT NULL DEFAULT '{}',
  pdf_url TEXT NOT NULL DEFAULT '',
  issued_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT einvoices_amounts_valid CHECK (subtotal >= 0 AND vat_rate_bps >= 0 AND vat_rate_bps <= 10000 AND vat_amount >= 0 AND total_amount = subtotal + vat_amount)
);
CREATE INDEX IF NOT EXISTS einvoices_status_idx ON einvoices (status, created_at);

CREATE OR REPLACE FUNCTION tp88_reject_closed_period_ledger() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_periods p
    WHERE p.status = 'closed' AND NEW.occurred_at >= p.starts_at AND NEW.occurred_at < p.ends_at
  ) THEN
    RAISE EXCEPTION 'accounting_period_closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS finance_ledger_closed_period_guard ON finance_ledger_entries;
CREATE TRIGGER finance_ledger_closed_period_guard
  BEFORE INSERT OR UPDATE ON finance_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION tp88_reject_closed_period_ledger();
