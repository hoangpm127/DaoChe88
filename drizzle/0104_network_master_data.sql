-- M2: dữ liệu gốc mạng lưới, lịch đóng cửa và ca làm việc.
-- 0103 được chừa cho M1 (danh tính/phân quyền); migration này tham chiếu các
-- bảng users và user_role_assignments do M1 tạo.

ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS opening_hours_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS service_radius_m INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS fulfillment_json TEXT NOT NULL DEFAULT '["delivery","pickup"]';
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS accepts_orders INTEGER NOT NULL DEFAULT 1;
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS opened_at TEXT;
ALTER TABLE operation_sites ADD COLUMN IF NOT EXISTS closed_at TEXT;

ALTER TABLE operation_staff ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS operation_staff_user_unique_idx
  ON operation_staff (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_closures (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  reason TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS site_closures_site_idx ON site_closures (site_id, starts_at);

CREATE TABLE IF NOT EXISTS work_shifts (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL REFERENCES operation_sites(id),
  user_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash INTEGER NOT NULL DEFAULT 0,
  counted_cash INTEGER,
  expected_cash INTEGER,
  variance INTEGER,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  CONSTRAINT work_shifts_cash_non_negative CHECK (
    opening_cash >= 0 AND (counted_cash IS NULL OR counted_cash >= 0)
  ),
  CONSTRAINT work_shifts_status_valid CHECK (status IN ('open', 'closed'))
);
CREATE INDEX IF NOT EXISTS work_shifts_site_idx ON work_shifts (site_id, opened_at);
CREATE UNIQUE INDEX IF NOT EXISTS work_shifts_one_open_per_site_idx
  ON work_shifts (site_id) WHERE status = 'open';

-- Cho phép nhánh M2 tự migrate/test khi M1 còn đang làm song song. Khi bảng
-- users đã có (0103 chạy trước 0104 sau lúc merge), bổ sung FK ngay trong cùng
-- migration; không hạ thấp ràng buộc của schema đích.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operation_sites_owner_user_fk') THEN
      ALTER TABLE operation_sites ADD CONSTRAINT operation_sites_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'operation_staff_user_fk') THEN
      ALTER TABLE operation_staff ADD CONSTRAINT operation_staff_user_fk FOREIGN KEY (user_id) REFERENCES users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_shifts_user_fk') THEN
      ALTER TABLE work_shifts ADD CONSTRAINT work_shifts_user_fk FOREIGN KEY (user_id) REFERENCES users(id);
    END IF;
  END IF;
END
$$;
