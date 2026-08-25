-- Danh tính và phân quyền thật (M1).
--
-- Thay thế cơ chế "một mã truy cập dùng chung mở mọi vai trò". Từ đây mỗi người
-- một tài khoản, quyền và phạm vi dữ liệu đọc từ bảng, thu hồi được phiên.
--
-- QUYẾT ĐỊNH ĐÃ CHỐT (xem docs/KE_HOACH_PHAT_TRIEN.md mục 3.3):
--   - Đăng nhập bằng SĐT + MẬT KHẨU cho cả nhân viên lẫn khách hàng.
--   - CHƯA có OTP ở đợt này vì brandname eSMS chưa được duyệt. Hai bảng
--     otp_challenges và password_reset_tokens vẫn được tạo sẵn để khi bật eSMS
--     chỉ cần thêm cài đặt gửi tin, không phải sửa schema.
--   - TUYỆT ĐỐI KHÔNG có luồng đặt lại mật khẩu tự phục vụ khi chưa có kênh xác
--     thực: ai nhập số điện thoại người khác cũng chiếm được tài khoản. Nhân
--     viên quên mật khẩu thì admin đặt lại hộ.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  phone_e164 TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  -- Lưu số vòng băm theo từng bản ghi để sau này nâng lên mà không làm hỏng
  -- mật khẩu cũ: kiểm bằng số vòng đã lưu, băm lại bằng số vòng mới khi đăng nhập.
  password_iterations INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT users_contact_required CHECK (phone_e164 <> '' OR email <> ''),
  CONSTRAINT users_status_valid CHECK (status IN ('active', 'suspended', 'left')),
  CONSTRAINT users_flags_valid CHECK (must_change_password IN (0, 1) AND phone_verified IN (0, 1))
);

-- Một số điện thoại chỉ thuộc về một tài khoản còn hiệu lực.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
  ON users (phone_e164) WHERE phone_e164 <> '' AND status <> 'left';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (email) WHERE email <> '' AND status <> 'left';

-- Một người có thể giữ nhiều vai trò ở nhiều điểm (ví dụ chủ 3 cửa hàng).
-- site_id NULL nghĩa là phạm vi toàn hệ thống.
CREATE TABLE IF NOT EXISTS user_role_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  site_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  valid_from TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  valid_to TEXT,
  granted_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT user_role_valid CHECK (role IN ('owner', 'kitchen', 'store-owner', 'store-staff', 'shipper', 'accountant', 'affiliate')),
  CONSTRAINT user_role_status_valid CHECK (status IN ('active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_role_unique_idx
  ON user_role_assignments (user_id, role, COALESCE(site_id, '*')) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS user_role_user_idx ON user_role_assignments (user_id, status);
CREATE INDEX IF NOT EXISTS user_role_site_idx ON user_role_assignments (site_id, role, status);

-- Phiên lưu phía máy chủ để thu hồi được. Cookie chỉ mang id phiên đã ký.
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  active_role TEXT NOT NULL,
  active_site_id TEXT,
  device_label TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id, revoked_at, expires_at);

-- Nhật ký đăng nhập: cần cho điều tra sự cố và phát hiện dò mật khẩu.
CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  event TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS auth_events_user_idx ON auth_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS auth_events_kind_idx ON auth_events (event, created_at);

-- Chặn dò mật khẩu. Để trong database thay vì bộ nhớ tiến trình, nếu không thì
-- chạy nhiều instance là giới hạn nhân lên và restart là mất sạch.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

-- Hai bảng dưới đây tạo sẵn cho lúc bật eSMS. Đợt này KHÔNG dùng.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  purpose TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  sent_at TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT otp_purpose_valid CHECK (purpose IN ('register', 'reset-password'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

-- Nối nhân sự vận hành với tài khoản đăng nhập.
ALTER TABLE operation_staff ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS operation_staff_user_idx ON operation_staff (user_id);
