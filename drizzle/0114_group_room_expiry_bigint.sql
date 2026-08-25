-- group_rooms.expires_at stores JavaScript epoch milliseconds (13 digits).
-- PostgreSQL INTEGER is only 32-bit, so room creation and expiry cleanup fail
-- with "out of range for type integer". BIGINT matches SQLite's integer range
-- and preserves the existing API representation without a unit conversion.
ALTER TABLE group_rooms
  ALTER COLUMN expires_at TYPE BIGINT USING expires_at::BIGINT;
