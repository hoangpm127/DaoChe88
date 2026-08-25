-- Schema PostgreSQL ban đầu cho Tào Phớ 88 (M0).
--
-- Sinh từ chính schema mà ứng dụng tạo ra trên SQLite, nên đảm bảo không sót
-- bảng nào. Ba khác biệt phải xử lý tay:
--   1. DEFAULT CURRENT_TIMESTAMP không gán được vào cột TEXT -> ép về chuỗi ISO.
--   2. Trigger SQLite RAISE(ABORT) -> hàm PL/pgSQL RAISE EXCEPTION.
--   3. Mệnh đề WHEN của trigger Postgres không chứa được subquery, mà điều kiện
--      toàn vẹn có NOT EXISTS(...) -> chuyển toàn bộ điều kiện vào thân hàm.
--
-- Cột cờ (is_test, track_stock, marketing_opt_in...) GIỮ kiểu INTEGER đúng như
-- SQLite, vì các ràng buộc CHECK hiện có so sánh trực tiếp với 0/1. Adapter quy
-- boolean về 0/1 trước khi gửi xuống.

-- ========== BẢNG ==========

CREATE TABLE IF NOT EXISTS affiliate_codes (code TEXT PRIMARY KEY NOT NULL, affiliate_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', is_test INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS affiliate_members (id TEXT PRIMARY KEY NOT NULL, source_request_id TEXT, access_token_hash TEXT, display_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', commission_bps INTEGER NOT NULL DEFAULT 800, payout_bank_code TEXT NOT NULL DEFAULT '', payout_account_number TEXT NOT NULL DEFAULT '', payout_account_name TEXT NOT NULL DEFAULT '', is_test INTEGER NOT NULL DEFAULT 1, approved_at TEXT, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS catalog_product_options (
      code TEXT PRIMARY KEY NOT NULL,
      product_sku TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'topping',
      name TEXT NOT NULL,
      price_delta INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS catalog_products (
      sku TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      base_price INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'VND',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      test_only INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS catalog_site_stock (
      id TEXT PRIMARY KEY NOT NULL,
      site_id TEXT NOT NULL,
      product_sku TEXT NOT NULL,
      on_hand INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      track_stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available',
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      CONSTRAINT catalog_site_stock_valid CHECK (track_stock = 0 OR (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand))
    );

CREATE TABLE IF NOT EXISTS catalog_stock_movements (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT,
      site_id TEXT NOT NULL,
      product_sku TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS catalog_stock_reservations (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      product_sku TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      phone_e164 TEXT NOT NULL DEFAULT '',
      email_normalized TEXT NOT NULL DEFAULT '',
      identity_status TEXT NOT NULL DEFAULT 'guest',
      status TEXT NOT NULL DEFAULT 'active',
      is_test INTEGER NOT NULL DEFAULT 1,
      source_environment TEXT NOT NULL DEFAULT 'test',
      marketing_opt_in INTEGER NOT NULL DEFAULT 0,
      marketing_consent_at TEXT,
      first_order_at TEXT NOT NULL,
      last_order_at TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      CONSTRAINT customers_contact_required CHECK (phone_e164 <> '' OR email_normalized <> ''),
      CONSTRAINT customers_environment_valid CHECK (source_environment IN ('test', 'live') AND is_test = CASE WHEN source_environment = 'test' THEN 1 ELSE 0 END),
      CONSTRAINT customers_marketing_valid CHECK (marketing_opt_in IN (0, 1))
    );

CREATE TABLE IF NOT EXISTS delivery_events (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT,
      provider TEXT NOT NULL DEFAULT 'lalamove',
      provider_order_id TEXT,
      event_type TEXT NOT NULL,
      provider_status TEXT,
      provider_updated_at TEXT,
      payload_json TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      processed_at TEXT,
      processing_result TEXT NOT NULL DEFAULT 'received'
    );

CREATE TABLE IF NOT EXISTS delivery_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'lalamove',
      environment TEXT NOT NULL DEFAULT 'sandbox',
      provider_order_id TEXT,
      provider_quotation_id TEXT,
      status TEXT NOT NULL DEFAULT 'booking',
      quoted_fee_amount INTEGER NOT NULL DEFAULT 0,
      actual_fee_amount INTEGER,
      currency TEXT NOT NULL DEFAULT 'VND',
      distance_meters INTEGER,
      driver_id TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      plate_number TEXT,
      tracking_url TEXT,
      pickup_eta TEXT,
      delivery_eta TEXT,
      booked_at TEXT,
      assigned_at TEXT,
      picked_up_at TEXT,
      completed_at TEXT,
      last_provider_updated_at TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS delivery_quotes (
      id TEXT PRIMARY KEY NOT NULL,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'lalamove',
      provider_quotation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      service_type TEXT NOT NULL,
      quoted_fee_amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'VND',
      distance_meters INTEGER,
      expires_at TEXT NOT NULL,
      request_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS finance_expenses (id TEXT PRIMARY KEY NOT NULL, expense_code TEXT NOT NULL, site_id TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, expense_date TEXT NOT NULL, vendor TEXT NOT NULL DEFAULT '', receipt_url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', submitted_by TEXT NOT NULL, approved_by TEXT, approved_at TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS finance_ledger_entries (id TEXT PRIMARY KEY NOT NULL, occurred_at TEXT NOT NULL, entry_type TEXT NOT NULL, direction TEXT NOT NULL, amount INTEGER NOT NULL, location_id TEXT, partner_id TEXT, order_id TEXT, expense_id TEXT, settlement_id TEXT, status TEXT NOT NULL DEFAULT 'posted', description TEXT NOT NULL, reference_code TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS finance_order_allocations (id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, policy_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'posted', gross_revenue INTEGER NOT NULL, workshop_cost INTEGER NOT NULL, partner_logistics INTEGER NOT NULL, landed_partner INTEGER NOT NULL, channel_pool INTEGER NOT NULL, affiliate_code TEXT, affiliate_bps INTEGER NOT NULL DEFAULT 0, affiliate_commission INTEGER NOT NULL DEFAULT 0, channel_contribution INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS finance_price_policies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', retail_bps INTEGER NOT NULL DEFAULT 10000, workshop_cost_bps INTEGER NOT NULL DEFAULT 2000, landed_partner_bps INTEGER NOT NULL DEFAULT 4000, channel_pool_bps INTEGER NOT NULL DEFAULT 6000, default_affiliate_bps INTEGER NOT NULL DEFAULT 800, effective_from TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS finance_settlements (id TEXT PRIMARY KEY NOT NULL, settlement_code TEXT NOT NULL, counterparty_type TEXT NOT NULL, counterparty_id TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, gross_amount INTEGER NOT NULL, deductions INTEGER NOT NULL DEFAULT 0, net_amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS group_room_items (
      id TEXT PRIMARY KEY NOT NULL,
      room_code TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS group_rooms (
      code TEXT PRIMARY KEY NOT NULL,
      host_token TEXT NOT NULL,
      office TEXT NOT NULL,
      slot TEXT NOT NULL DEFAULT '14:30',
      cutoff TEXT NOT NULL DEFAULT '13:45',
      address TEXT NOT NULL DEFAULT '',
      recipient TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      payment TEXT NOT NULL DEFAULT 'Chủ phòng thanh toán',
      shipping_mode TEXT NOT NULL DEFAULT 'delivery',
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

CREATE TABLE IF NOT EXISTS inbound_requests (id TEXT PRIMARY KEY NOT NULL, request_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', source_environment TEXT NOT NULL DEFAULT 'test', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_alerts (id TEXT PRIMARY KEY NOT NULL, severity TEXT NOT NULL DEFAULT 'info', category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', assigned_role TEXT NOT NULL DEFAULT 'super-admin', entity_type TEXT, entity_id TEXT, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), resolved_at TEXT, updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_event_log (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor_role TEXT NOT NULL, actor_name TEXT NOT NULL DEFAULT 'Demo operator', from_state TEXT, to_state TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_inventory (id TEXT PRIMARY KEY NOT NULL, site_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, on_hand INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'healthy', updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_order_items (id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, product_code TEXT NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, base_unit_price INTEGER NOT NULL DEFAULT 0, options_unit_price INTEGER NOT NULL DEFAULT 0, unit_price INTEGER NOT NULL, line_total INTEGER NOT NULL DEFAULT 0, customization_json TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_orders (id TEXT PRIMARY KEY NOT NULL, order_code TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'webapp', customer_id TEXT, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL DEFAULT '', delivery_address TEXT NOT NULL, delivery_latitude_e6 INTEGER, delivery_longitude_e6 INTEGER, fulfillment_type TEXT NOT NULL DEFAULT 'delivery', site_id TEXT NOT NULL, partner_id TEXT, currency TEXT NOT NULL DEFAULT 'VND', subtotal_amount INTEGER NOT NULL DEFAULT 0, delivery_fee_amount INTEGER NOT NULL DEFAULT 0, discount_amount INTEGER NOT NULL DEFAULT 0, total_amount INTEGER NOT NULL, item_count INTEGER NOT NULL DEFAULT 1, payment_method TEXT NOT NULL DEFAULT 'bank_transfer', payment_provider TEXT, payment_status TEXT NOT NULL DEFAULT 'pending', is_test INTEGER NOT NULL DEFAULT 1, source_environment TEXT NOT NULL DEFAULT 'test', order_status TEXT NOT NULL DEFAULT 'new', kitchen_status TEXT NOT NULL DEFAULT 'queued', delivery_status TEXT NOT NULL DEFAULT 'unassigned', assigned_shipper_id TEXT, promised_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), tracking_token_hash TEXT, client_reference TEXT, data_schema_version INTEGER NOT NULL DEFAULT 12, cancelled_at TEXT, completed_at TEXT, cancellation_reason TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS operation_partners (id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, owner_name TEXT NOT NULL, phone TEXT NOT NULL, district TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'lead', onboarding_stage TEXT NOT NULL DEFAULT 'new', location_count INTEGER NOT NULL DEFAULT 0, commission_bps INTEGER NOT NULL DEFAULT 800, monthly_revenue INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_sites (id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', address TEXT NOT NULL, district TEXT NOT NULL DEFAULT '', manager_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', capacity_per_hour INTEGER NOT NULL DEFAULT 0, active_orders INTEGER NOT NULL DEFAULT 0, partner_id TEXT, latitude_e6 INTEGER, longitude_e6 INTEGER, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS operation_staff (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', site_id TEXT, status TEXT NOT NULL DEFAULT 'available', current_task TEXT NOT NULL DEFAULT '', rating_x10 INTEGER NOT NULL DEFAULT 50, completed_today INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS order_fulfillment_details (
      order_id TEXT PRIMARY KEY NOT NULL,
      customer_id TEXT,
      fulfillment_type TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL DEFAULT '',
      formatted_address TEXT NOT NULL,
      address_line1 TEXT NOT NULL,
      ward TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT 'VN',
      latitude_e6 INTEGER,
      longitude_e6 INTEGER,
      pickup_site_name TEXT NOT NULL DEFAULT '',
      pickup_site_address TEXT NOT NULL DEFAULT '',
      pickup_site_phone TEXT NOT NULL DEFAULT '',
      delivery_instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      FOREIGN KEY (order_id) REFERENCES operation_orders(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      CONSTRAINT order_fulfillment_type_valid CHECK (fulfillment_type IN ('delivery', 'pickup')),
      CONSTRAINT order_fulfillment_coordinates_valid CHECK ((latitude_e6 IS NULL AND longitude_e6 IS NULL) OR (latitude_e6 BETWEEN -90000000 AND 90000000 AND longitude_e6 BETWEEN -180000000 AND 180000000))
    );

CREATE TABLE IF NOT EXISTS payment_attempts (id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'sepay', payment_code TEXT NOT NULL, bank_code TEXT NOT NULL, bank_account TEXT NOT NULL, expected_amount INTEGER NOT NULL, received_amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'VND', status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL, paid_at TEXT, provider_transaction_id TEXT, qr_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS payment_refunds (id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, attempt_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'sepay', refund_code TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'VND', reason TEXT NOT NULL, provider_reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', requested_by TEXT NOT NULL, completed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS payment_transactions (id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL DEFAULT 'sepay', provider_transaction_id TEXT NOT NULL, gateway TEXT NOT NULL, transaction_date TEXT NOT NULL, account_number TEXT NOT NULL, sub_account TEXT NOT NULL DEFAULT '', payment_code TEXT, content TEXT NOT NULL DEFAULT '', transfer_type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', transfer_amount INTEGER NOT NULL, accumulated INTEGER NOT NULL DEFAULT 0, reference_code TEXT NOT NULL DEFAULT '', attempt_id TEXT, order_id TEXT, match_status TEXT NOT NULL DEFAULT 'received', payload_json TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), processed_at TEXT);

CREATE TABLE IF NOT EXISTS runtime_schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS runtime_storage_health (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

CREATE TABLE IF NOT EXISTS saved_group_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      recipient TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      delivery_note TEXT NOT NULL DEFAULT '',
      delivery_slot TEXT NOT NULL DEFAULT '14:30',
      cutoff TEXT NOT NULL DEFAULT '13:45',
      payment TEXT NOT NULL DEFAULT 'Mỗi người tự thanh toán',
      shipping_mode TEXT NOT NULL DEFAULT 'delivery',
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );



-- ========== CHỈ MỤC ==========

CREATE INDEX IF NOT EXISTS affiliate_codes_member_idx ON affiliate_codes (affiliate_id, status);

CREATE INDEX IF NOT EXISTS affiliate_members_phone_idx ON affiliate_members (phone, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_members_source_request_unique_idx ON affiliate_members (source_request_id);

CREATE INDEX IF NOT EXISTS affiliate_members_status_idx ON affiliate_members (status, updated_at);

CREATE INDEX IF NOT EXISTS catalog_product_options_product_idx ON catalog_product_options (product_sku, status, sort_order);

CREATE INDEX IF NOT EXISTS catalog_products_status_idx ON catalog_products (status, category, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_site_stock_site_sku_unique_idx ON catalog_site_stock (site_id, product_sku);

CREATE INDEX IF NOT EXISTS catalog_site_stock_status_idx ON catalog_site_stock (site_id, status, product_sku);

CREATE INDEX IF NOT EXISTS catalog_stock_movements_order_idx ON catalog_stock_movements (order_id, created_at);

CREATE INDEX IF NOT EXISTS catalog_stock_movements_product_idx ON catalog_stock_movements (site_id, product_sku, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_stock_reservations_order_sku_unique_idx ON catalog_stock_reservations (order_id, product_sku);

CREATE INDEX IF NOT EXISTS catalog_stock_reservations_status_idx ON catalog_stock_reservations (site_id, status, product_sku);

CREATE UNIQUE INDEX IF NOT EXISTS customers_email_env_unique_idx ON customers (source_environment, email_normalized) WHERE email_normalized <> '' AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_env_unique_idx ON customers (source_environment, phone_e164) WHERE phone_e164 <> '' AND status = 'active';

CREATE INDEX IF NOT EXISTS customers_status_idx ON customers (source_environment, status, updated_at);

CREATE INDEX IF NOT EXISTS delivery_events_job_idx ON delivery_events (job_id, received_at);

CREATE INDEX IF NOT EXISTS delivery_events_provider_order_idx ON delivery_events (provider, provider_order_id, received_at);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_jobs_order_unique_idx ON delivery_jobs (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_jobs_provider_order_unique_idx ON delivery_jobs (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_jobs_status_idx ON delivery_jobs (status, updated_at);

CREATE INDEX IF NOT EXISTS delivery_quotes_expiry_idx ON delivery_quotes (status, expires_at);

CREATE INDEX IF NOT EXISTS delivery_quotes_order_idx ON delivery_quotes (order_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_quotes_provider_id_unique_idx ON delivery_quotes (provider, provider_quotation_id);

CREATE UNIQUE INDEX IF NOT EXISTS finance_expenses_code_unique_idx ON finance_expenses (expense_code);

CREATE INDEX IF NOT EXISTS finance_expenses_site_idx ON finance_expenses (site_id, expense_date);

CREATE INDEX IF NOT EXISTS finance_expenses_status_idx ON finance_expenses (status, created_at);

CREATE INDEX IF NOT EXISTS finance_ledger_location_idx ON finance_ledger_entries (location_id, occurred_at);

CREATE INDEX IF NOT EXISTS finance_ledger_occurred_idx ON finance_ledger_entries (occurred_at, status);

CREATE INDEX IF NOT EXISTS finance_ledger_order_idx ON finance_ledger_entries (order_id, entry_type);

CREATE INDEX IF NOT EXISTS finance_order_allocations_order_idx ON finance_order_allocations (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS finance_order_allocations_order_unique_idx ON finance_order_allocations (order_id);

CREATE INDEX IF NOT EXISTS finance_order_allocations_status_idx ON finance_order_allocations (status, created_at);

CREATE INDEX IF NOT EXISTS finance_price_policies_status_idx ON finance_price_policies (status, effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS finance_settlements_code_unique_idx ON finance_settlements (settlement_code);

CREATE INDEX IF NOT EXISTS finance_settlements_counterparty_idx ON finance_settlements (counterparty_type, counterparty_id, period_end);

CREATE INDEX IF NOT EXISTS finance_settlements_status_idx ON finance_settlements (status, updated_at);

CREATE INDEX IF NOT EXISTS group_room_items_room_idx ON group_room_items (room_code, created_at);

CREATE INDEX IF NOT EXISTS group_rooms_expiry_idx ON group_rooms (expires_at, status);

CREATE INDEX IF NOT EXISTS inbound_requests_phone_idx ON inbound_requests (phone, created_at);

CREATE INDEX IF NOT EXISTS inbound_requests_status_idx ON inbound_requests (status, request_type, created_at);

CREATE INDEX IF NOT EXISTS operation_alerts_status_idx ON operation_alerts (status, severity);

CREATE INDEX IF NOT EXISTS operation_event_entity_idx ON operation_event_log (entity_type, entity_id, created_at);

CREATE INDEX IF NOT EXISTS operation_inventory_site_idx ON operation_inventory (site_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS operation_inventory_site_sku_unique_idx ON operation_inventory (site_id, sku);

CREATE INDEX IF NOT EXISTS operation_order_items_order_idx ON operation_order_items (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS operation_orders_client_ref_unique_idx ON operation_orders (source_environment, client_reference) WHERE client_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS operation_orders_code_unique_idx ON operation_orders (order_code);

CREATE INDEX IF NOT EXISTS operation_orders_customer_idx ON operation_orders (customer_id, created_at);

CREATE INDEX IF NOT EXISTS operation_orders_delivery_idx ON operation_orders (delivery_status, assigned_shipper_id);

CREATE INDEX IF NOT EXISTS operation_orders_environment_idx ON operation_orders (source_environment, is_test, created_at);

CREATE INDEX IF NOT EXISTS operation_orders_kitchen_idx ON operation_orders (kitchen_status, promised_at);

CREATE INDEX IF NOT EXISTS operation_orders_site_idx ON operation_orders (site_id, created_at);

CREATE INDEX IF NOT EXISTS operation_orders_status_idx ON operation_orders (order_status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS operation_partners_code_unique_idx ON operation_partners (code);

CREATE INDEX IF NOT EXISTS operation_partners_status_idx ON operation_partners (status, onboarding_stage);

CREATE INDEX IF NOT EXISTS operation_sites_code_idx ON operation_sites (code);

CREATE UNIQUE INDEX IF NOT EXISTS operation_sites_code_unique_idx ON operation_sites (code);

CREATE INDEX IF NOT EXISTS operation_sites_status_idx ON operation_sites (status, kind);

CREATE INDEX IF NOT EXISTS operation_staff_role_idx ON operation_staff (role, status);

CREATE INDEX IF NOT EXISTS order_fulfillment_customer_idx ON order_fulfillment_details (customer_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_code_unique_idx ON payment_attempts (payment_code);

CREATE INDEX IF NOT EXISTS payment_attempts_order_idx ON payment_attempts (order_id, created_at);

CREATE INDEX IF NOT EXISTS payment_attempts_status_idx ON payment_attempts (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_code_unique_idx ON payment_refunds (refund_code);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_order_unique_idx ON payment_refunds (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_reference_unique_idx ON payment_refunds (provider, provider_reference);

CREATE INDEX IF NOT EXISTS payment_transactions_attempt_idx ON payment_transactions (attempt_id, received_at);

CREATE INDEX IF NOT EXISTS payment_transactions_match_idx ON payment_transactions (match_status, received_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_provider_id_unique_idx ON payment_transactions (provider, provider_transaction_id);

CREATE INDEX IF NOT EXISTS saved_group_profiles_user_idx ON saved_group_profiles (user_email, updated_at);



-- ========== TRIGGER TOÀN VẸN ==========

CREATE OR REPLACE FUNCTION operation_order_items_integrity_check() RETURNS trigger AS $$
BEGIN
  IF (NEW.quantity <= 0 OR NEW.quantity > 100 OR NEW.base_unit_price < 0 OR NEW.options_unit_price < 0
        OR NEW.unit_price != NEW.base_unit_price + NEW.options_unit_price
        OR NEW.line_total != NEW.unit_price * NEW.quantity
        OR NOT EXISTS (SELECT 1 FROM operation_orders WHERE id = NEW.order_id)) THEN
    RAISE EXCEPTION 'operation_order_items_integrity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS operation_order_items_integrity_trigger ON operation_order_items;
CREATE TRIGGER operation_order_items_integrity_trigger
  BEFORE UPDATE OR INSERT ON operation_order_items
  FOR EACH ROW EXECUTE FUNCTION operation_order_items_integrity_check();

CREATE OR REPLACE FUNCTION operation_orders_integrity_check() RETURNS trigger AS $$
BEGIN
  IF (NEW.subtotal_amount < 0 OR NEW.delivery_fee_amount < 0 OR NEW.discount_amount < 0
        OR NEW.discount_amount > NEW.subtotal_amount + NEW.delivery_fee_amount
        OR NEW.total_amount != NEW.subtotal_amount + NEW.delivery_fee_amount - NEW.discount_amount
        OR NEW.item_count <= 0 OR NEW.currency != 'VND'
        OR NEW.fulfillment_type NOT IN ('delivery', 'pickup')
        OR NEW.payment_method NOT IN ('bank_transfer', 'cash')
        OR NEW.source_environment NOT IN ('test', 'live')
        OR NEW.is_test != CASE WHEN NEW.source_environment = 'test' THEN 1 ELSE 0 END
        OR NEW.data_schema_version < 1) THEN
    RAISE EXCEPTION 'operation_orders_integrity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS operation_orders_integrity_trigger ON operation_orders;
CREATE TRIGGER operation_orders_integrity_trigger
  BEFORE UPDATE OR INSERT ON operation_orders
  FOR EACH ROW EXECUTE FUNCTION operation_orders_integrity_check();

CREATE OR REPLACE FUNCTION payment_attempts_integrity_check() RETURNS trigger AS $$
BEGIN
  IF (NEW.expected_amount <= 0 OR NEW.received_amount < 0 OR NEW.currency != 'VND'
        OR NOT EXISTS (SELECT 1 FROM operation_orders WHERE id = NEW.order_id)) THEN
    RAISE EXCEPTION 'payment_attempts_integrity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_attempts_integrity_trigger ON payment_attempts;
CREATE TRIGGER payment_attempts_integrity_trigger
  BEFORE UPDATE OR INSERT ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION payment_attempts_integrity_check();
