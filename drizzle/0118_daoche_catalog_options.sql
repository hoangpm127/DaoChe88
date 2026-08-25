-- Nạp lại định danh thực đơn Đảo Chè cho môi trường đã lỡ chạy bản 0101 cũ.
--
-- 0117 dọn sạch món của thương hiệu cũ, nhưng topping của Đảo Chè thì chưa bao giờ
-- được nạp: chúng nằm trong bản 0101 mới — bản bị bỏ qua vì số hiệu 101 đã được ghi
-- nhận. Và scripts/import-catalog.mjs chỉ nạp NỘI DUNG món, không nạp topping.
-- Kết quả trên production: 15 món đúng nhưng 0 topping, khách không chọn thêm được gì.
--
-- ON CONFLICT DO NOTHING nên đây là lệnh rỗng ở database dựng mới (0101 đã nạp đủ),
-- và chỉ điền phần thiếu ở database đã chạy bản cũ. Giá hiện hành không bị ghi đè.

INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-BUOI', 'Chè bưởi Năm Roi', 'Chè', 28000, 'VND', '["DC-CHEBUOI"]', 'active', 0, 10) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-KHUCBACH', 'Chè khúc bạch nhãn', 'Chè', 34000, 'VND', '["DC-KB"]', 'active', 0, 20) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-SAURIENG', 'Chè Thái sầu riêng', 'Chè', 39000, 'VND', '["DC-SR"]', 'active', 0, 30) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-KHOAIDEO', 'Chè khoai dẻo ngũ sắc', 'Chè', 32000, 'VND', '["DC-KD"]', 'active', 0, 40) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-DUADAM', 'Chè dừa dầm Hải Phòng', 'Chè', 30000, 'VND', '["DC-DD"]', 'active', 0, 50) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-DAUXANH', 'Chè đậu xanh cốt dừa', 'Chè', 22000, 'VND', '[]', 'active', 0, 60) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-SENNHAN', 'Chè hạt sen long nhãn', 'Chè', 32000, 'VND', '[]', 'active', 0, 70) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-THAPCAM', 'Chè thập cẩm Đảo Chè', 'Chè', 30000, 'VND', '[]', 'active', 0, 80) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-SUONGSAO', 'Chè sương sáo lá dứa', 'Chè', 20000, 'VND', '[]', 'active', 0, 90) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-TROINUOC', 'Chè trôi nước gừng', 'Chè', 25000, 'VND', '[]', 'active', 0, 100) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-BAPCOT', 'Chè bắp cốt dừa', 'Chè', 24000, 'VND', '["DC-CHEBAP"]', 'active', 0, 110) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-MATCHA', 'Matcha latte sữa dừa', 'Đồ uống', 39000, 'VND', '[]', 'active', 0, 200) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-SENLANEP', 'Sữa sen lá nếp', 'Đồ uống', 32000, 'VND', '["DC-SEN"]', 'active', 0, 210) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-CB-10', 'Combo giữa giờ 10 phần', 'Combo văn phòng', 259000, 'VND', '[]', 'active', 0, 300) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('DC-CB-20', 'Combo cả tầng 20 phần', 'Combo văn phòng', 498000, 'VND', '[]', 'active', 0, 310) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('TEST-SEPAY-2K', 'Kiểm thử webhook SePay 2.000đ', 'Kiểm thử', 2000, 'VND', '[]', 'active', 1, 9999) ON CONFLICT DO NOTHING;

INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-BUOI.TOPPING.1', 'DC-BUOI', 'topping', 'Trân châu trắng', 5000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-BUOI.TOPPING.2', 'DC-BUOI', 'topping', 'Cốt dừa thêm', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-BUOI.TOPPING.3', 'DC-BUOI', 'topping', 'Đậu xanh thêm', 6000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-KHUCBACH.TOPPING.1', 'DC-KHUCBACH', 'topping', 'Khúc bạch thêm', 10000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-KHUCBACH.TOPPING.2', 'DC-KHUCBACH', 'topping', 'Long nhãn', 9000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-KHUCBACH.TOPPING.3', 'DC-KHUCBACH', 'topping', 'Hạnh nhân lát', 6000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SAURIENG.TOPPING.1', 'DC-SAURIENG', 'topping', 'Sầu riêng thêm', 12000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SAURIENG.TOPPING.2', 'DC-SAURIENG', 'topping', 'Thạch lá dứa', 6000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SAURIENG.TOPPING.3', 'DC-SAURIENG', 'topping', 'Mít thái sợi', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-KHOAIDEO.TOPPING.1', 'DC-KHOAIDEO', 'topping', 'Khoai dẻo thêm', 8000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-KHOAIDEO.TOPPING.2', 'DC-KHOAIDEO', 'topping', 'Trân châu trắng', 5000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-KHOAIDEO.TOPPING.3', 'DC-KHOAIDEO', 'topping', 'Cốt dừa thêm', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-DUADAM.TOPPING.1', 'DC-DUADAM', 'topping', 'Cùi dừa thêm', 8000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-DUADAM.TOPPING.2', 'DC-DUADAM', 'topping', 'Thạch dừa', 6000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-DUADAM.TOPPING.3', 'DC-DUADAM', 'topping', 'Sữa dừa gấp đôi', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-DAUXANH.TOPPING.1', 'DC-DAUXANH', 'topping', 'Phổ tai thêm', 5000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-DAUXANH.TOPPING.2', 'DC-DAUXANH', 'topping', 'Cốt dừa thêm', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SENNHAN.TOPPING.1', 'DC-SENNHAN', 'topping', 'Hạt sen thêm', 9000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SENNHAN.TOPPING.2', 'DC-SENNHAN', 'topping', 'Long nhãn', 10000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SENNHAN.TOPPING.3', 'DC-SENNHAN', 'topping', 'Thạch quế hoa', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-THAPCAM.TOPPING.1', 'DC-THAPCAM', 'topping', 'Thêm 3 topping', 9000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-THAPCAM.TOPPING.2', 'DC-THAPCAM', 'topping', 'Sầu riêng', 12000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-THAPCAM.TOPPING.3', 'DC-THAPCAM', 'topping', 'Cốt dừa thêm', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SUONGSAO.TOPPING.1', 'DC-SUONGSAO', 'topping', 'Sương sáo thêm', 5000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SUONGSAO.TOPPING.2', 'DC-SUONGSAO', 'topping', 'Thạch lá dứa', 6000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-TROINUOC.TOPPING.1', 'DC-TROINUOC', 'topping', 'Viên trôi thêm', 7000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-TROINUOC.TOPPING.2', 'DC-TROINUOC', 'topping', 'Vừng rang', 4000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-BAPCOT.TOPPING.1', 'DC-BAPCOT', 'topping', 'Bắp thêm', 6000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-BAPCOT.TOPPING.2', 'DC-BAPCOT', 'topping', 'Dừa nạo', 5000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-MATCHA.TOPPING.1', 'DC-MATCHA', 'topping', 'Foam dừa', 9000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-MATCHA.TOPPING.2', 'DC-MATCHA', 'topping', 'Thạch matcha', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-MATCHA.TOPPING.3', 'DC-MATCHA', 'topping', 'Shot matcha', 12000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SENLANEP.TOPPING.1', 'DC-SENLANEP', 'topping', 'Hạt sen', 8000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-SENLANEP.TOPPING.2', 'DC-SENLANEP', 'topping', 'Thạch lá dứa', 6000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-CB-10.TOPPING.1', 'DC-CB-10', 'topping', 'Thêm 2 phần', 52000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-CB-10.TOPPING.2', 'DC-CB-10', 'topping', 'Túi giữ lạnh', 15000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-CB-10.TOPPING.3', 'DC-CB-10', 'topping', 'Bộ thìa giấy', 0, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-CB-20.TOPPING.1', 'DC-CB-20', 'topping', 'Thêm 5 phần', 120000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-CB-20.TOPPING.2', 'DC-CB-20', 'topping', 'Khung giờ ưu tiên', 20000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('DC-CB-20.TOPPING.3', 'DC-CB-20', 'topping', 'Bộ thìa giấy', 0, 'active', 3) ON CONFLICT DO NOTHING;
