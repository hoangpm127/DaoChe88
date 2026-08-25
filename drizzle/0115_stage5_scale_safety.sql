-- Giai đoạn 5: truy vấn scoped, realtime đa instance và nền tảng vận hành.

CREATE INDEX IF NOT EXISTS operation_orders_site_status_created_idx
  ON operation_orders (site_id, order_status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS operation_orders_active_promised_idx
  ON operation_orders (site_id, promised_at, id)
  WHERE order_status NOT IN ('delivered', 'cancelled');

CREATE INDEX IF NOT EXISTS finance_ledger_location_occurred_type_idx
  ON finance_ledger_entries (location_id, occurred_at DESC, entry_type, id DESC);

CREATE INDEX IF NOT EXISTS catalog_site_stock_site_status_idx
  ON catalog_site_stock (site_id, status, product_sku);

CREATE INDEX IF NOT EXISTS operation_alerts_status_created_idx
  ON operation_alerts (status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key       TEXT PRIMARY KEY,
  requests         INTEGER NOT NULL CHECK (requests > 0),
  window_started_at TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at);

CREATE TABLE IF NOT EXISTS stream_connections (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  site_id    TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stream_connections_user_expiry_idx
  ON stream_connections (user_id, expires_at);

CREATE TABLE IF NOT EXISTS application_request_log (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL,
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  user_id     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS application_request_log_created_idx
  ON application_request_log (created_at);
CREATE INDEX IF NOT EXISTS application_request_log_route_status_idx
  ON application_request_log (route, status_code, created_at);

CREATE TABLE IF NOT EXISTS pii_access_log (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  access_type  TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL DEFAULT '',
  filter_json  TEXT NOT NULL DEFAULT '{}',
  row_count    INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pii_access_log_actor_created_idx
  ON pii_access_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pii_access_log_entity_created_idx
  ON pii_access_log (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS monitor_incidents (
  incident_key TEXT PRIMARY KEY,
  category     TEXT NOT NULL,
  severity     TEXT NOT NULL,
  title        TEXT NOT NULL,
  detail_json  TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'open',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  notified_at  TEXT,
  resolved_at  TEXT
);
CREATE INDEX IF NOT EXISTS monitor_incidents_status_seen_idx
  ON monitor_incidents (status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS privacy_consents (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  user_id       TEXT,
  consent_type  TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  revoked_at    TEXT,
  source        TEXT NOT NULL DEFAULT 'web'
);
CREATE INDEX IF NOT EXISTS privacy_consents_customer_idx
  ON privacy_consents (customer_id, consent_type, granted_at DESC);
CREATE INDEX IF NOT EXISTS privacy_consents_user_idx
  ON privacy_consents (user_id, consent_type, granted_at DESC);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS terms_accepted_at TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS privacy_accepted_at TEXT;
