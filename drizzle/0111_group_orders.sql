-- M5 — Đơn nhóm thật: chốt phòng ra một đơn hàng, chia tiền, hoa hồng chủ phòng.
--
-- Trước M5 phòng nhóm chỉ là một danh sách món rồi đổ vào giỏ chủ phòng; chốt
-- phòng không sinh ra đơn hàng nào. Từ đây phòng chốt xong là có đơn thật, mỗi
-- người một dòng món mang tên mình, và chủ phòng được ghi nhận hoa hồng.
--
-- LỆCH SO VỚI BẢN KẾ HOẠCH (có chủ đích): kế hoạch thêm cột closes_at TEXT bên
-- cạnh expires_at đang có. Hai cột cùng mô tả một thời điểm chắc chắn sẽ lệch
-- nhau. Giữ nguyên expires_at (epoch ms) làm nguồn duy nhất và chỉ nới khoảng
-- thời gian hợp lệ ở tầng ứng dụng, từ 5 phút cứng thành 15 phút–24 giờ.

ALTER TABLE group_rooms ADD COLUMN IF NOT EXISTS site_id TEXT;
ALTER TABLE group_rooms ADD COLUMN IF NOT EXISTS host_user_id TEXT;
ALTER TABLE group_rooms ADD COLUMN IF NOT EXISTS host_phone_e164 TEXT NOT NULL DEFAULT '';
ALTER TABLE group_rooms ADD COLUMN IF NOT EXISTS order_id TEXT;
-- host_pays: chủ phòng trả toàn bộ. each_pays: mỗi người một mã VietQR riêng và
-- đơn chỉ vào bếp khi tổng đã thu đủ.
ALTER TABLE group_rooms ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'host_pays';
ALTER TABLE group_rooms ADD COLUMN IF NOT EXISTS host_commission_bps INTEGER NOT NULL DEFAULT 0;

-- Postgres không có ADD CONSTRAINT IF NOT EXISTS, mà migration phải chạy lại
-- được mà không đổi gì (Định nghĩa hoàn thành của M0).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_rooms_split_mode_valid') THEN
    ALTER TABLE group_rooms ADD CONSTRAINT group_rooms_split_mode_valid
      CHECK (split_mode IN ('host_pays', 'each_pays')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS group_rooms_order_idx ON group_rooms (order_id);
CREATE INDEX IF NOT EXISTS group_rooms_host_idx ON group_rooms (host_phone_e164, created_at);

ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS option_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS sweetness TEXT NOT NULL DEFAULT '';
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS guest_phone TEXT NOT NULL DEFAULT '';
-- Nối dòng món trong phòng sang dòng món của đơn thật, để in tem theo tên người
-- và để biết ai đã trả phần nào.
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS order_item_id TEXT;
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS payment_attempt_id TEXT;
-- Đánh dấu dòng món do chính chủ phòng đặt: chủ phòng không được ăn hoa hồng
-- trên phần của mình.
ALTER TABLE group_room_items ADD COLUMN IF NOT EXISTS is_host INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS group_room_items_payment_idx ON group_room_items (room_code, payment_status);

-- Nguồn giới thiệu dùng chung cho affiliate (M6) và chủ phòng nhóm (M5).
--
-- Một đơn chỉ được ghi nhận MỘT nguồn cho mỗi loại người giới thiệu; chỉ mục
-- duy nhất bên dưới là thứ chặn việc cộng hoa hồng hai lần cho cùng một đơn.
CREATE TABLE IF NOT EXISTS order_referrals (
  id                TEXT PRIMARY KEY NOT NULL,
  order_id          TEXT NOT NULL REFERENCES operation_orders(id) ON DELETE RESTRICT,
  referrer_type     TEXT NOT NULL,
  referrer_id       TEXT NOT NULL,
  referral_code     TEXT NOT NULL DEFAULT '',
  commission_bps    INTEGER NOT NULL DEFAULT 0,
  commission_amount INTEGER NOT NULL DEFAULT 0,
  -- pending: đơn chưa giao xong. earned: đã giao và qua thời hạn khiếu nại.
  -- paid: đã nằm trong một lô chi trả. void: đơn bị hủy hoặc hoàn tiền.
  status            TEXT NOT NULL DEFAULT 'pending',
  earned_at         TEXT,
  voided_reason     TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at        TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT order_referrals_type_valid CHECK (referrer_type IN ('affiliate', 'group_host', 'store_staff')),
  CONSTRAINT order_referrals_status_valid CHECK (status IN ('pending', 'earned', 'paid', 'void')),
  CONSTRAINT order_referrals_amount_valid CHECK (commission_amount >= 0 AND commission_bps >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS order_referrals_unique_idx ON order_referrals (order_id, referrer_type);
CREATE INDEX IF NOT EXISTS order_referrals_referrer_idx ON order_referrals (referrer_type, referrer_id, status);
CREATE INDEX IF NOT EXISTS order_referrals_status_idx ON order_referrals (status, created_at);
