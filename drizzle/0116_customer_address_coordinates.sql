-- Toạ độ cho sổ địa chỉ của khách.
--
-- Bảng customer_addresses (M11) lưu địa chỉ dạng chữ nhưng không có toạ độ, nên
-- không tính được khoảng cách hay phí giao cho một địa chỉ đã lưu. Giao diện
-- trước đây lấp chỗ đó bằng chuỗi khoảng cách lưu sẵn trong localStorage — tức
-- là một con số không ai tính lại, và sai ngay khi khách đổi địa chỉ.
--
-- Lưu dạng phần triệu độ (e6) giống operation_sites và order_fulfillment_details,
-- để cùng một phép Haversine dùng được cho cả ba bảng.
--
-- Cho phép NULL: địa chỉ nhập tay mà khách không bấm định vị thì chưa có toạ độ,
-- và đó là trạng thái hợp lệ — giao diện phải nói rõ là chưa có, chứ không bịa.

ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS latitude_e6 INTEGER;
ALTER TABLE customer_addresses ADD COLUMN IF NOT EXISTS longitude_e6 INTEGER;

ALTER TABLE customer_addresses DROP CONSTRAINT IF EXISTS customer_addresses_coordinates_valid;
ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_coordinates_valid
  CHECK (
    (latitude_e6 IS NULL AND longitude_e6 IS NULL)
    OR (latitude_e6 BETWEEN -90000000 AND 90000000 AND longitude_e6 BETWEEN -180000000 AND 180000000)
  );

-- Khách đăng ký mà chưa đặt đơn nào thì THẬT SỰ chưa có ngày đơn đầu tiên.
--
-- Trước đây hồ sơ khách chỉ sinh ra lúc đặt đơn, nên cột này luôn có giá trị và
-- để NOT NULL là hợp lý. Nay khách đăng ký tài khoản là đã có hồ sơ (để lưu được
-- sổ địa chỉ), nên trạng thái "chưa từng đặt đơn" phải biểu diễn được.
--
-- Điền đại ngày đăng ký vào đây sẽ khiến mọi báo cáo đọc cột này tưởng khách đã
-- mua hàng — sai số liệu ở chỗ khó phát hiện nhất.

ALTER TABLE customers ALTER COLUMN first_order_at DROP NOT NULL;
ALTER TABLE customers ALTER COLUMN last_order_at DROP NOT NULL;

INSERT INTO runtime_schema_migrations (version, name)
  VALUES (116, 'customer-address-coordinates')
  ON CONFLICT DO NOTHING;
