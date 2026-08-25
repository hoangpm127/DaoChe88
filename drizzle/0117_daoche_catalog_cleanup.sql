-- Dọn thực đơn của thương hiệu cũ ra khỏi database Đảo Chè.
--
-- VÌ SAO CẦN MIGRATION NÀY
-- ========================
-- Bản 0101 cũ nạp 12 món tào phớ/chè của thương hiệu mẹ. Database production của
-- Đảo Chè đã chạy đúng bản 0101 ĐÓ (lúc 13:42) trước khi thực đơn được viết lại.
-- Trình chạy migration ghi nhận theo SỐ HIỆU: bảng runtime_schema_migrations đã có
-- version 101, nên bản 0101 mới — bản chỉ chứa 15 món DC-* — không bao giờ được áp.
--
-- Hậu quả quan sát được: GET /api/catalog trả về 27 món, gồm cả "Tào phớ hoa nhài",
-- "Tào phớ cốt dừa", "Tào phớ mè đen", "Tào phớ gừng ấm". Sửa lại 0101 lần nữa cũng
-- vô ích vì nó sẽ tiếp tục bị bỏ qua. Việc dọn phải là một migration MỚI.
--
-- NGUYÊN TẮC XOÁ
-- ==============
-- Món đã từng được đặt là DỮ LIỆU KẾ TOÁN, không được xoá — dòng đơn hàng cũ tham
-- chiếu tới nó và lịch sử tiền phải tra ngược được. Những món đó chỉ bị chuyển sang
-- status 'archived' để biến mất khỏi thực đơn (API lọc status = 'active') mà vẫn còn
-- nguyên trong database. Chỉ món chưa từng xuất hiện trong đơn nào mới bị xoá hẳn.
--
-- TEST-SEPAY-2K được giữ lại: đó là món kiểm thử webhook, không thuộc thương hiệu nào.

-- 1. Ẩn những món đã có lịch sử đặt hàng (không xoá).
UPDATE catalog_products
SET status = 'archived',
    updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE sku NOT LIKE 'DC-%'
  AND sku <> 'TEST-SEPAY-2K'
  AND sku IN (SELECT product_code FROM operation_order_items WHERE product_code IS NOT NULL);

UPDATE catalog_product_options
SET status = 'archived'
WHERE product_sku IN (SELECT sku FROM catalog_products WHERE status = 'archived');

-- 2. Xoá hẳn những món chưa từng được đặt. Topping đi trước vì trỏ ngược lại món.
DELETE FROM catalog_product_options
WHERE product_sku IN (
  SELECT sku FROM catalog_products
  WHERE sku NOT LIKE 'DC-%'
    AND sku <> 'TEST-SEPAY-2K'
    AND sku NOT IN (SELECT product_code FROM operation_order_items WHERE product_code IS NOT NULL)
);

DELETE FROM catalog_price_overrides
WHERE product_sku IN (
  SELECT sku FROM catalog_products
  WHERE sku NOT LIKE 'DC-%'
    AND sku <> 'TEST-SEPAY-2K'
    AND sku NOT IN (SELECT product_code FROM operation_order_items WHERE product_code IS NOT NULL)
);

DELETE FROM catalog_site_stock
WHERE product_sku IN (
  SELECT sku FROM catalog_products
  WHERE sku NOT LIKE 'DC-%'
    AND sku <> 'TEST-SEPAY-2K'
    AND sku NOT IN (SELECT product_code FROM operation_order_items WHERE product_code IS NOT NULL)
);

DELETE FROM catalog_products
WHERE sku NOT LIKE 'DC-%'
  AND sku <> 'TEST-SEPAY-2K'
  AND sku NOT IN (SELECT product_code FROM operation_order_items WHERE product_code IS NOT NULL);
