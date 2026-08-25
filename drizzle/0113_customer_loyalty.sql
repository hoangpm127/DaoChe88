-- M11 — Khách hàng: tài khoản, lịch sử, điểm thưởng, ưu đãi, thông báo, đánh giá.
--
-- Mục tiêu là gỡ hết số giả trong giao diện khách: tab "Ưu đãi" đang hiện
-- "04 voucher · đã tiết kiệm 426.000đ" cứng trong mã, điểm thưởng hiện trên mọi
-- món nhưng không cộng vào đâu, 6 thông báo và toàn bộ rating đều là hằng số.
--
-- ============================================================
-- QUYẾT ĐỊNH AN TOÀN: TÀI KHOẢN MỚI KHÔNG TỰ NHẬN ĐƠN CŨ
-- ============================================================
-- Chưa có kênh xác minh số điện thoại (eSMS chưa duyệt brandname). Nếu tài khoản
-- mới đăng ký tự động thấy mọi đơn từng đặt bằng số đó, thì bất kỳ ai đăng ký
-- bằng số người khác cũng đọc được tên, địa chỉ và lịch sử mua của họ.
--
-- Vì vậy: đơn CHỈ gắn vào tài khoản khi đặt lúc đã đăng nhập, hoặc sau khi số
-- điện thoại được xác minh. Cột phone_verified_at bên dưới dành sẵn cho lúc bật
-- OTP; khi đó mở khoá lịch sử cũ là một câu UPDATE.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier TEXT NOT NULL DEFAULT 'member';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS order_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TEXT;
-- Mốc hồ sơ khách được gắn vào tài khoản. Đơn trước mốc này chỉ hiện sau khi
-- số điện thoại được xác minh (chờ eSMS).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_linked_at TEXT;

CREATE INDEX IF NOT EXISTS customers_user_idx ON customers (user_id);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id                TEXT PRIMARY KEY NOT NULL,
  customer_id       TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  label             TEXT NOT NULL DEFAULT '',
  recipient_name    TEXT NOT NULL DEFAULT '',
  recipient_phone   TEXT NOT NULL DEFAULT '',
  formatted_address TEXT NOT NULL,
  ward              TEXT NOT NULL DEFAULT '',
  district          TEXT NOT NULL DEFAULT '',
  city              TEXT NOT NULL DEFAULT '',
  latitude_e6       INTEGER,
  longitude_e6      INTEGER,
  instructions      TEXT NOT NULL DEFAULT '',
  is_default        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at        TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses (customer_id, is_default);

-- Sổ cái điểm thưởng. balance_after lưu sẵn để đối chiếu được số dư tại từng
-- thời điểm mà không phải cộng dồn lại toàn bộ lịch sử.
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id               TEXT PRIMARY KEY NOT NULL,
  customer_id      TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  points           INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  order_id         TEXT,
  balance_after    INTEGER NOT NULL DEFAULT 0,
  expires_at       TEXT,
  description      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT loyalty_type_valid CHECK (transaction_type IN ('earn', 'redeem', 'expire', 'adjust'))
);

CREATE INDEX IF NOT EXISTS loyalty_transactions_customer_idx ON loyalty_transactions (customer_id, created_at);
-- Một đơn chỉ được cộng điểm đúng một lần.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_earn_order_unique_idx
  ON loyalty_transactions (order_id, transaction_type) WHERE order_id IS NOT NULL AND transaction_type = 'earn';

CREATE TABLE IF NOT EXISTS promotions (
  id                       TEXT PRIMARY KEY NOT NULL,
  code                     TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  promo_type               TEXT NOT NULL,
  value                    INTEGER NOT NULL DEFAULT 0,
  max_discount             INTEGER,
  min_order_amount         INTEGER NOT NULL DEFAULT 0,
  scope_json               TEXT NOT NULL DEFAULT '{}',
  usage_limit              INTEGER,
  usage_limit_per_customer INTEGER NOT NULL DEFAULT 1,
  used_count               INTEGER NOT NULL DEFAULT 0,
  starts_at                TEXT NOT NULL,
  ends_at                  TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active',
  created_by               TEXT NOT NULL DEFAULT '',
  created_at               TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT promotions_type_valid CHECK (promo_type IN ('percent', 'fixed', 'free_ship')),
  CONSTRAINT promotions_status_valid CHECK (status IN ('active', 'paused', 'expired'))
);

CREATE INDEX IF NOT EXISTS promotions_status_idx ON promotions (status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id              TEXT PRIMARY KEY NOT NULL,
  promotion_id    TEXT NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  customer_id     TEXT,
  order_id        TEXT NOT NULL REFERENCES operation_orders(id) ON DELETE RESTRICT,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- Chốt chặn thật cho việc dùng lại mã trên cùng một đơn.
CREATE UNIQUE INDEX IF NOT EXISTS promotion_redemption_order_idx ON promotion_redemptions (promotion_id, order_id);
CREATE INDEX IF NOT EXISTS promotion_redemption_customer_idx ON promotion_redemptions (promotion_id, customer_id);

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY NOT NULL,
  recipient_type TEXT NOT NULL,
  recipient_id   TEXT NOT NULL,
  category       TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  action_url     TEXT NOT NULL DEFAULT '',
  entity_type    TEXT,
  entity_id      TEXT,
  read_at        TEXT,
  sent_push_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT notifications_recipient_valid CHECK (recipient_type IN ('customer', 'user'))
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_type, recipient_id, created_at);
-- Một sự kiện của một đơn chỉ sinh đúng một thông báo, dù job chạy lại bao nhiêu lần.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_entity_category_idx
  ON notifications (recipient_type, recipient_id, entity_type, entity_id, category);

CREATE TABLE IF NOT EXISTS product_reviews (
  id            TEXT PRIMARY KEY NOT NULL,
  order_id      TEXT NOT NULL REFERENCES operation_orders(id) ON DELETE RESTRICT,
  order_item_id TEXT NOT NULL,
  customer_id   TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_sku   TEXT NOT NULL,
  site_id       TEXT NOT NULL DEFAULT '',
  rating        INTEGER NOT NULL,
  comment       TEXT NOT NULL DEFAULT '',
  photo_url     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'published',
  reply         TEXT NOT NULL DEFAULT '',
  replied_by    TEXT,
  replied_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT product_reviews_rating_valid CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT product_reviews_status_valid CHECK (status IN ('published', 'hidden'))
);

-- Chỉ được đánh giá mỗi dòng món đã mua đúng một lần: đây là thứ ngăn việc tự
-- bơm điểm sao cho món của mình.
CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_item_unique_idx ON product_reviews (order_item_id);
CREATE INDEX IF NOT EXISTS product_reviews_product_idx ON product_reviews (product_sku, status, created_at);

-- Vai trò "customer" cho phép khách có tài khoản đăng nhập thật.
-- Ràng buộc vai trò ở 0103_auth.sql chưa có giá trị này nên phải nới ra.
ALTER TABLE user_role_assignments DROP CONSTRAINT IF EXISTS user_role_valid;
ALTER TABLE user_role_assignments ADD CONSTRAINT user_role_valid
  CHECK (role IN ('owner', 'kitchen', 'store-owner', 'store-staff', 'shipper', 'accountant', 'affiliate', 'customer'));
