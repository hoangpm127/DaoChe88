-- Nạp thực đơn gốc (M0).
--
-- Trước đây phần này nằm trong ensureCatalogSchema và chạy trong đường chạy
-- request. Đây là DỮ LIỆU THAM CHIẾU nên thuộc về migration.
-- Dùng ON CONFLICT DO NOTHING để lần đổi giá sau của admin (module M3)
-- không bị một lần deploy ghi đè trở lại giá gốc.

INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('TP-T2-S', 'Tào phớ hoa nhài', 'Tào phớ', 15000, 'VND', '["TP-HN"]', 'active', 0, 10) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('TP-T3-M', 'Tào phớ cốt dừa', 'Tào phớ', 22000, 'VND', '["TP-CD"]', 'active', 0, 20) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('CH-C2-M', 'Chè bưởi Út Bảy', 'Chè', 24000, 'VND', '["CH-BUOI"]', 'active', 0, 30) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('CH-C7-M', 'Chè thập cẩm 88', 'Chè', 28000, 'VND', '[]', 'active', 0, 40) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('U-U3', 'Matcha latte sữa dừa', 'Đồ uống', 39000, 'VND', '[]', 'active', 0, 50) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('TP-MD-M', 'Tào phớ mè đen', 'Tào phớ', 26000, 'VND', '["TP-MD"]', 'active', 0, 60) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('CH-HS-LN', 'Chè hạt sen long nhãn', 'Chè', 32000, 'VND', '[]', 'active', 0, 70) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('CB-VP-10', 'Combo giữa giờ 10 phần', 'Combo văn phòng', 229000, 'VND', '[]', 'active', 0, 80) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('TP-GUNG', 'Tào phớ gừng ấm', 'Tào phớ', 18000, 'VND', '[]', 'active', 0, 90) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('CH-KB', 'Chè khúc bạch nhãn', 'Chè', 34000, 'VND', '[]', 'active', 0, 100) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('U-SEN', 'Sữa sen lá nếp', 'Đồ uống', 32000, 'VND', '["TS-TC"]', 'active', 0, 110) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('CB-VP-20', 'Combo cả tầng 20 phần', 'Combo văn phòng', 438000, 'VND', '[]', 'active', 0, 120) ON CONFLICT DO NOTHING;
INSERT INTO catalog_products (sku, name, category, base_price, currency, aliases_json, status, test_only, sort_order) VALUES ('TEST-SEPAY-2K', 'Kiểm thử webhook SePay 2.000đ', 'Kiểm thử', 2000, 'VND', '[]', 'active', 1, 9999) ON CONFLICT DO NOTHING;

INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-T2-S.TOPPING.1', 'TP-T2-S', 'topping', 'Trân châu mini', 5000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-T2-S.TOPPING.2', 'TP-T2-S', 'topping', 'Thạch lá nếp', 6000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-T2-S.TOPPING.3', 'TP-T2-S', 'topping', 'Cốt dừa', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-T3-M.TOPPING.1', 'TP-T3-M', 'topping', 'Cốt dừa gấp đôi', 7000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-T3-M.TOPPING.2', 'TP-T3-M', 'topping', 'Hạt sen', 8000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-T3-M.TOPPING.3', 'TP-T3-M', 'topping', 'Thạch găng', 5000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-C2-M.TOPPING.1', 'CH-C2-M', 'topping', 'Đậu xanh thêm', 6000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-C2-M.TOPPING.2', 'CH-C2-M', 'topping', 'Cốt dừa', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-C2-M.TOPPING.3', 'CH-C2-M', 'topping', 'Dừa sợi', 5000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-C7-M.TOPPING.1', 'CH-C7-M', 'topping', 'Thêm 3 topping', 9000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-C7-M.TOPPING.2', 'CH-C7-M', 'topping', 'Sầu riêng', 12000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-C7-M.TOPPING.3', 'CH-C7-M', 'topping', 'Cốt dừa', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('U-U3.TOPPING.1', 'U-U3', 'topping', 'Foam dừa', 9000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('U-U3.TOPPING.2', 'U-U3', 'topping', 'Thạch matcha', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('U-U3.TOPPING.3', 'U-U3', 'topping', 'Shot matcha', 12000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-MD-M.TOPPING.1', 'TP-MD-M', 'topping', 'Sốt mè gấp đôi', 8000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-MD-M.TOPPING.2', 'TP-MD-M', 'topping', 'Tào phớ thêm', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-MD-M.TOPPING.3', 'TP-MD-M', 'topping', 'Lạc rang', 4000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-HS-LN.TOPPING.1', 'CH-HS-LN', 'topping', 'Hạt sen thêm', 9000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-HS-LN.TOPPING.2', 'CH-HS-LN', 'topping', 'Long nhãn', 10000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-HS-LN.TOPPING.3', 'CH-HS-LN', 'topping', 'Thạch quế hoa', 7000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CB-VP-10.TOPPING.1', 'CB-VP-10', 'topping', 'Thêm 2 phần', 42000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CB-VP-10.TOPPING.2', 'CB-VP-10', 'topping', 'Túi giữ lạnh', 15000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CB-VP-10.TOPPING.3', 'CB-VP-10', 'topping', 'Bộ thìa giấy', 0, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-GUNG.TOPPING.1', 'TP-GUNG', 'topping', 'Trân châu gừng', 6000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('TP-GUNG.TOPPING.2', 'TP-GUNG', 'topping', 'Tào phớ thêm', 7000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-KB.TOPPING.1', 'CH-KB', 'topping', 'Khúc bạch thêm', 10000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-KB.TOPPING.2', 'CH-KB', 'topping', 'Long nhãn', 9000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CH-KB.TOPPING.3', 'CH-KB', 'topping', 'Hạnh nhân', 6000, 'active', 3) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('U-SEN.TOPPING.1', 'U-SEN', 'topping', 'Hạt sen', 8000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('U-SEN.TOPPING.2', 'U-SEN', 'topping', 'Thạch lá nếp', 6000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CB-VP-20.TOPPING.1', 'CB-VP-20', 'topping', 'Thêm 5 phần', 105000, 'active', 1) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CB-VP-20.TOPPING.2', 'CB-VP-20', 'topping', 'Khung giờ ưu tiên', 20000, 'active', 2) ON CONFLICT DO NOTHING;
INSERT INTO catalog_product_options (code, product_sku, kind, name, price_delta, status, sort_order) VALUES ('CB-VP-20.TOPPING.3', 'CB-VP-20', 'topping', 'Bộ thìa giấy', 0, 'active', 3) ON CONFLICT DO NOTHING;
