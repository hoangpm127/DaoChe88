# Đảo Chè — 6 không gian làm việc, 17 vai trò

Hệ thống không tạo 17 ứng dụng riêng. Các vai trò dùng chung sáu workspace, còn API xác định quyền từ phiên đã ký và lọc dữ liệu theo phạm vi trước khi trả về giao diện.

## 1. Khách hàng & Cộng đồng — `/order`

1. Khách truy cập chưa đăng nhập
2. Khách hàng có hồ sơ
3. Thành viên đơn nhóm
4. Chủ phòng / người chốt đơn nhóm
5. Affiliate / Đại sứ

## 2. Đối tác & Phát triển điểm — `/portal`

6. Ứng viên đối tác / mở điểm
9. Đối tác phân phối / chủ điểm đối tác
10. Chủ mở điểm / chủ đầu tư

## 3. Vận hành cửa hàng — `/portal`

8. Nhân viên cửa hàng
12. Quản lý cửa hàng

## 4. Giao nhận — `/portal`

7. Shipper tuyến
11. Điều phối giao nhận

## 5. Sản xuất & Mạng lưới — `/portal`

13. Bếp tổng / quản lý bếp tổng
14. Quản lý vùng / cụm

## 6. Tài chính, Kiểm soát & Hệ thống — `/portal`

15. Tài chính – Kế toán – Đối soát
16. Kiểm soát nội bộ / QA hệ thống
17. Super Admin / chủ hệ thống

## Nguyên tắc quyền

- Mỗi thiết bị có một phiên portal riêng; đổi vai trò phải tạo lại phiên phía máy chủ.
- URL và JSON do trình duyệt gửi không quyết định vai trò.
- API chỉ trả dữ liệu đã được lọc theo vai trò; UI tiếp tục lọc để trình bày nhưng không phải lớp bảo mật.
- `order.create` là hành động công khai của khách hàng; các lệnh vận hành khác cần phiên portal hợp lệ.
- Không vai trò nào mặc định thành Super Admin.
- Tài chính lập/đối soát; Kiểm soát duyệt ngoại lệ; người vận hành không tự chốt khoản có lợi ích liên quan.
- Cookie phiên là `HttpOnly`, có chữ ký, thời hạn và được xóa khi đăng xuất.

## Cấu hình môi trường trước khi chạy online

- `PORTAL_DEMO_ACCESS_CODE`: mã dùng chung tạm thời để mở role picker trong giai đoạn cùng thiết kế.
- `PORTAL_SESSION_SECRET`: chuỗi bí mật ít nhất 32 ký tự để ký phiên.
- `SQLITE_PATH` hoặc `DATABASE_PATH`: đường dẫn volume bền vững trên Railway.

Mã truy cập dùng chung chỉ dành cho giai đoạn demo. Trước khi nhập dữ liệu thật cần thay bằng tài khoản riêng, OTP/MFA, membership theo phạm vi và phê duyệt kép.

## Smoke test nhiều thiết bị

1. Mở `/portal` trên hai điện thoại hoặc hai trình duyệt độc lập.
2. Chọn hai vai trò khác nhau và nhập mã truy cập demo.
3. Xử lý một bản ghi trên máy A.
4. Làm mới hoặc chờ đồng bộ trên máy B; kiểm tra trạng thái dùng chung.
5. Gọi cùng API bằng role giả trong URL/body; hệ thống phải bỏ qua và vẫn dùng role trong cookie.
6. Đăng xuất máy A; request vận hành tiếp theo phải trả `401`.
7. Kiểm tra shipper không xem tài chính toàn hệ thống, nhân viên cửa hàng không duyệt chi phí, Kiểm soát không tạo giao dịch nguồn.
8. Cập nhật phiên bản và kiểm tra PWA không cache `/portal`, `/api` hoặc dữ liệu nhạy cảm.
