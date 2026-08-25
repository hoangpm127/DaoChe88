-- Hạ tầng cấu hình động (M0, nền cho module M14).
--
-- Ranh giới phải giữ rõ:
--   - BÍ MẬT và HẠ TẦNG (chuỗi kết nối, khóa API, secret phiên, đường dẫn volume)
--     đọc từ biến môi trường qua lib/config.ts.
--   - THÔNG SỐ NGHIỆP VỤ (ngưỡng, tỷ lệ, thời hạn, phí) đọc từ bảng này, để admin
--     tự chỉnh trong phần mềm mà không cần deploy lại.
--
-- scope_type = 'global' áp dụng toàn hệ thống; 'site' cho phép ghi đè theo từng
-- cửa hàng. Thứ tự giải: site -> global -> giá trị mặc định trong sổ đăng ký.

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'global',
  scope_value TEXT NOT NULL DEFAULT '*',
  value_json TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  CONSTRAINT system_settings_pk PRIMARY KEY (key, scope_type, scope_value),
  CONSTRAINT system_settings_scope_valid CHECK (scope_type IN ('global', 'site'))
);

-- Mọi lần đổi thông số đều phải có vết: ai đổi, đổi từ gì sang gì, vì sao.
CREATE TABLE IF NOT EXISTS system_setting_history (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE INDEX IF NOT EXISTS system_setting_history_key_idx
  ON system_setting_history (key, changed_at);
