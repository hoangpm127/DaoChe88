-- M6 — Affiliate: tài khoản thật, cửa sổ quy kết, chống gian lận, chi trả theo lô.
--
-- Trước M6 cộng tác viên xem hoa hồng bằng một token nằm trong localStorage và
-- một request-id trên query string. Ai có link là xem được, không thu hồi được,
-- và mất máy là mất tài khoản. Từ đây họ có tài khoản đăng nhập thật.
--
-- KHÔNG CÓ OTP ở đợt này: brandname eSMS chưa được duyệt (quyết định Q3). Cộng
-- tác viên đăng nhập bằng SĐT + mật khẩu do admin cấp khi duyệt hồ sơ, giống
-- nhân viên. Tuyệt đối không làm quên-mật-khẩu tự phục vụ khi chưa có kênh xác
-- thực — ai nhập số người khác cũng chiếm được tài khoản và rút hoa hồng.

ALTER TABLE affiliate_members ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE affiliate_members ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE affiliate_members ADD COLUMN IF NOT EXISTS tax_code TEXT NOT NULL DEFAULT '';
-- CCCD lưu dạng băm để chống một người mở nhiều hồ sơ, mà không giữ số gốc.
ALTER TABLE affiliate_members ADD COLUMN IF NOT EXISTS id_number_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_members ADD COLUMN IF NOT EXISTS suspended_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS affiliate_members_user_idx ON affiliate_members (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_members_id_number_idx
  ON affiliate_members (id_number_hash) WHERE id_number_hash <> '';

-- Cửa sổ quy kết: khách bấm link ?ref=CODE hôm nay, đặt hàng vài ngày sau vẫn
-- được tính cho người giới thiệu.
--
-- visitor_hash là băm của IP + User-Agent, KHÔNG lưu IP thô: đây là dữ liệu cá
-- nhân mà mục đích sử dụng chỉ cần so khớp, không cần đọc lại.
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id                 TEXT PRIMARY KEY NOT NULL,
  code               TEXT NOT NULL,
  visitor_hash       TEXT NOT NULL,
  landed_at          TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  converted_order_id TEXT,
  created_at         TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS affiliate_clicks_visitor_idx ON affiliate_clicks (visitor_hash, expires_at);
CREATE INDEX IF NOT EXISTS affiliate_clicks_code_idx ON affiliate_clicks (code, landed_at);

-- Chi trả theo lô. Tách batch/item để một lần chuyển khoản hàng loạt tương ứng
-- đúng một bản ghi có người duyệt và thời điểm duyệt.
CREATE TABLE IF NOT EXISTS payout_batches (
  id                TEXT PRIMARY KEY NOT NULL,
  batch_code        TEXT NOT NULL UNIQUE,
  counterparty_type TEXT NOT NULL,
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  total_amount      INTEGER NOT NULL DEFAULT 0,
  tax_withheld      INTEGER NOT NULL DEFAULT 0,
  entry_count       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft',
  export_file_url   TEXT NOT NULL DEFAULT '',
  approved_by       TEXT,
  approved_at       TEXT,
  paid_at           TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at        TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT payout_batches_status_valid CHECK (status IN ('draft', 'approved', 'exported', 'paid')),
  CONSTRAINT payout_batches_type_valid CHECK (counterparty_type IN ('affiliate', 'group_host', 'partner', 'store'))
);

CREATE INDEX IF NOT EXISTS payout_batches_status_idx ON payout_batches (status, created_at);

CREATE TABLE IF NOT EXISTS payout_items (
  id                 TEXT PRIMARY KEY NOT NULL,
  batch_id           TEXT NOT NULL REFERENCES payout_batches(id) ON DELETE RESTRICT,
  referral_id        TEXT REFERENCES order_referrals(id) ON DELETE RESTRICT,
  recipient_id       TEXT NOT NULL,
  recipient_name     TEXT NOT NULL DEFAULT '',
  gross_amount       INTEGER NOT NULL DEFAULT 0,
  -- Hoa hồng vượt ngưỡng phải khấu trừ thuế TNCN tại nguồn; lưu riêng để cuối
  -- năm còn báo cáo được số đã khấu trừ cho từng người.
  tax_withheld       INTEGER NOT NULL DEFAULT 0,
  amount             INTEGER NOT NULL DEFAULT 0,
  bank_code          TEXT NOT NULL DEFAULT '',
  account_number     TEXT NOT NULL DEFAULT '',
  account_name       TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'pending',
  provider_reference TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT payout_items_status_valid CHECK (status IN ('pending', 'paid', 'failed')),
  CONSTRAINT payout_items_amount_valid CHECK (gross_amount >= 0 AND tax_withheld >= 0 AND amount >= 0)
);

-- Một khoản hoa hồng chỉ được nằm trong đúng một lô chi trả. Đây là chốt chặn
-- thật cho việc trả hai lần, không phải kiểm tra ở tầng ứng dụng.
CREATE UNIQUE INDEX IF NOT EXISTS payout_items_referral_unique_idx
  ON payout_items (referral_id) WHERE referral_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payout_items_batch_idx ON payout_items (batch_id, status);
