-- =====================================================================
-- KIỂM TRA DỮ LIỆU PRODUCTION — CHỈ ĐỌC
-- =====================================================================
-- Chạy được nhiều lần, không sửa/xoá bất cứ thứ gì. Toàn bộ là SELECT.
--
-- CÁCH CHẠY
--   railway login            (một lần, mở trình duyệt để xác thực)
--   railway link             (chọn project TA88 → environment production)
--   railway connect Postgres < scripts/audit-production.sql
--
-- Hoặc dán thẳng vào tab Data của service Postgres trên railway.com.
--
-- VÌ SAO CẦN CHẠY THỦ CÔNG: Postgres chỉ nghe trên postgres.railway.internal,
-- không mở cổng công khai (đúng theo khuyến nghị M0). Project token
-- (RAILWAY_TOKEN) đọc được biến môi trường nhưng không đăng ký được SSH key nên
-- không vào được mạng nội bộ — cần workspace token hoặc railway login.
-- =====================================================================

\echo '========== 1. MẠNG LƯỚI ĐIỂM BÁN (đối chiếu tiêu chí M2) =========='
-- M2 yêu cầu: 23 cửa hàng đang mở + 1 bếp tổng.
SELECT kind, status, COUNT(*) AS so_luong
FROM operation_sites
GROUP BY kind, status
ORDER BY kind, status;

\echo '---------- Tổng số điểm đang mở (không tính quán affiliate) ----------'
SELECT COUNT(*) AS cua_hang_dang_mo
FROM operation_sites
WHERE status = 'open' AND kind <> 'partner-counter';

\echo '---------- Điểm bán thiếu thông tin người phụ trách ----------'
-- M2 cố ý KHÔNG bịa tên quản lý và số điện thoại. Đây là danh sách còn trống
-- thật, cần điền trước khi vận hành.
SELECT COUNT(*) FILTER (WHERE manager_name = '') AS thieu_ten_quan_ly,
       COUNT(*) FILTER (WHERE phone = '')        AS thieu_so_dien_thoai,
       COUNT(*)                                  AS tong_diem_ban
FROM operation_sites;


\echo '========== 2. ĐƠN HÀNG — THẬT HAY THỬ =========='
-- is_test = 1 nghĩa là đơn sinh ra khi ORDER_DATA_MODE=test. Chừng nào cột này
-- còn toàn 1 thì chưa có đồng doanh thu thật nào.
SELECT source_environment,
       is_test,
       order_status,
       COUNT(*)          AS so_don,
       SUM(total_amount) AS tong_tien
FROM operation_orders
GROUP BY source_environment, is_test, order_status
ORDER BY source_environment, is_test, so_don DESC;

\echo '---------- Đơn theo ngày, 14 ngày gần nhất ----------'
SELECT LEFT(created_at, 10) AS ngay, COUNT(*) AS so_don
FROM operation_orders
WHERE created_at >= to_char(now() - interval '14 days', 'YYYY-MM-DD')
GROUP BY 1 ORDER BY 1 DESC;

\echo '---------- DẤU VẾT DỮ LIỆU DEMO CÒN SÓT ----------'
-- Bản demo cũ dùng mã đơn dạng order-2408xx và tên khách bịa. Nếu có kết quả ở
-- đây thì dữ liệu demo đã lọt vào production.
SELECT id, order_code, customer_name, customer_phone, created_at
FROM operation_orders
WHERE id LIKE 'order-24%'
   OR customer_name IN ('Mai Anh', 'Hà Nguyễn', 'Nhóm Product Tầng 22')
   OR customer_phone IN ('0912888088', '0912 888 088')
ORDER BY created_at
LIMIT 50;


\echo '========== 3. TÀI KHOẢN VÀ PHÂN QUYỀN (đối chiếu M1) =========='
SELECT u.status, COUNT(*) AS so_tai_khoan
FROM users u GROUP BY u.status ORDER BY 1;

\echo '---------- Vai trò đã gán, kèm phạm vi điểm bán ----------'
SELECT r.role,
       r.status,
       COUNT(*)                                    AS so_nguoi,
       COUNT(*) FILTER (WHERE r.site_id IS NULL)   AS pham_vi_toan_he_thong,
       COUNT(*) FILTER (WHERE r.site_id IS NOT NULL) AS gan_dung_diem_ban
FROM user_role_assignments r
GROUP BY r.role, r.status
ORDER BY r.role;

\echo '---------- Phân công trỏ vào điểm bán KHÔNG tồn tại (phải rỗng) ----------'
SELECT r.id, r.role, r.site_id
FROM user_role_assignments r
LEFT JOIN operation_sites s ON s.id = r.site_id
WHERE r.site_id IS NOT NULL AND s.id IS NULL;

\echo '---------- Tài khoản còn nợ đổi mật khẩu ----------'
SELECT COUNT(*) AS chua_doi_mat_khau_lan_dau
FROM users WHERE must_change_password = 1;


\echo '========== 4. KHÁCH HÀNG VÀ M11 =========='
SELECT COUNT(*)                                          AS tong_khach,
       COUNT(*) FILTER (WHERE user_id IS NOT NULL)       AS da_co_tai_khoan,
       COUNT(*) FILTER (WHERE phone_verified_at IS NOT NULL) AS da_xac_minh_sdt,
       COUNT(*) FILTER (WHERE is_test = 1)               AS khach_thu_nghiem
FROM customers;

\echo '---------- Số bản ghi trong các bảng M11 ----------'
SELECT 'loyalty_transactions' AS bang, COUNT(*) AS so_ban_ghi FROM loyalty_transactions
UNION ALL SELECT 'promotions',            COUNT(*) FROM promotions
UNION ALL SELECT 'promotion_redemptions', COUNT(*) FROM promotion_redemptions
UNION ALL SELECT 'notifications',         COUNT(*) FROM notifications
UNION ALL SELECT 'product_reviews',       COUNT(*) FROM product_reviews
UNION ALL SELECT 'customer_addresses',    COUNT(*) FROM customer_addresses
ORDER BY 1;


\echo '========== 5. CHUỖI CUNG ỨNG VÀ TÀI CHÍNH (M7, M8, M10) =========='
SELECT 'production_batches'     AS bang, COUNT(*) AS so_ban_ghi FROM production_batches
UNION ALL SELECT 'finance_ledger_entries', COUNT(*) FROM finance_ledger_entries
UNION ALL SELECT 'cash_movements',         COUNT(*) FROM cash_movements
UNION ALL SELECT 'payment_attempts',       COUNT(*) FROM payment_attempts
UNION ALL SELECT 'payment_transactions',   COUNT(*) FROM payment_transactions
UNION ALL SELECT 'affiliate_members',      COUNT(*) FROM affiliate_members
ORDER BY 1;

\echo '---------- Sổ cái theo loại bút toán ----------'
SELECT entry_type, direction, COUNT(*) AS so_but_toan, SUM(amount) AS tong_tien
FROM finance_ledger_entries
GROUP BY entry_type, direction
ORDER BY 1, 2;


\echo '========== 6. THỰC ĐƠN — ĐỘ ĐẦY ĐỦ NỘI DUNG =========='
-- API công khai cho thấy 13 món đều trống mô tả, ảnh, thành phần. Truy vấn này
-- đếm chính xác còn thiếu bao nhiêu.
SELECT COUNT(*)                                              AS tong_mon,
       COUNT(*) FILTER (WHERE COALESCE(description,'') = '') AS thieu_mo_ta,
       COUNT(*) FILTER (WHERE COALESCE(image_url,'')   = '') AS thieu_anh,
       COUNT(*) FILTER (WHERE COALESCE(ingredients,'') = '') AS thieu_thanh_phan,
       COUNT(*) FILTER (WHERE COALESCE(allergens,'')   = '') AS thieu_di_ung
FROM catalog_products;


\echo '========== 7. PHIÊN BẢN SCHEMA =========='
SELECT MAX(version) AS phien_ban_hien_tai, COUNT(*) AS so_migration_da_chay
FROM runtime_schema_migrations;

\echo '========== HẾT =========='
