# Hướng dẫn cấu hình hệ thống (M14)

M14 đưa các ngưỡng, tỷ lệ, thời hạn và phí nghiệp vụ vào `system_settings`. Owner có thể chỉnh trong tab **Cài đặt** của portal; không cần sửa mã nguồn hoặc deploy lại.

## Cách hệ thống chọn giá trị

Thứ tự ưu tiên là:

1. Giá trị ghi đè của đúng điểm bán (`scope_type = site`).
2. Giá trị toàn hệ thống (`scope_type = global`).
3. Giá trị mặc định an toàn trong `lib/settings-registry.ts`.

Chỉ các thông số được đánh dấu `allowSiteOverride` trong registry mới có thể đặt riêng theo điểm. Owner được chỉnh toàn hệ thống và từng điểm. Store-owner chỉ được chỉnh thông số cho phép ghi đè tại điểm thuộc phạm vi của mình; không được chỉnh toàn hệ thống. Accountant chỉ được chỉnh nhóm thông số được registry cấp quyền, hiện gồm danh mục chi phí.

## Hiệu lực và cache

Mỗi tiến trình ứng dụng cache cấu hình trong 60 giây để luồng đặt hàng không phải truy vấn lại database liên tục. Cache của tiến trình nhận lệnh được xóa ngay sau khi cập nhật hoặc reset. Nếu Railway chạy nhiều instance, instance khác có thể dùng giá trị cũ tối đa 60 giây.

Giá trị mới chỉ áp dụng cho bản ghi tạo sau thay đổi. Đơn hàng và phân bổ hoa hồng đã ghi luôn giữ snapshot tại thời điểm tạo; thay đổi bậc Affiliate không sửa ngược dữ liệu cũ.

## Nhật ký và khôi phục

Mọi lần cập nhật ghi đồng thời vào:

- `system_settings`: giá trị đang áp dụng;
- `system_setting_history`: giá trị cũ, mới, lý do, người đổi và thời điểm;
- `operation_event_log`: dấu vết chung của hệ thống vận hành.

Nút **Mặc định** hoặc **Bỏ ghi đè** xóa hàng tương ứng trong `system_settings`, sau đó hệ thống quay về giá trị kế thừa. Lần reset vẫn có lịch sử.

## Ranh giới cấu hình

- Thông số nghiệp vụ (phí, ngưỡng, tỷ lệ, thời hạn) nằm trong registry và `system_settings`.
- Dữ liệu chủ (điểm bán, món, nhân sự, giá) nằm trong bảng nghiệp vụ riêng.
- Bí mật và hạ tầng (DATABASE_URL, khóa SePay/Lalamove, secret phiên, cổng, đường dẫn volume, số vòng băm mật khẩu) vẫn phải đặt bằng biến môi trường và không xuất hiện trên màn hình M14.

Trần/sàn trong registry là ràng buộc an toàn không thể vượt, kể cả owner. Ví dụ vị trí shipper không được lưu quá 7 ngày theo nguyên tắc bảo vệ dữ liệu cá nhân, phiên portal không quá 24 giờ, hoa hồng không quá 20%, và ngưỡng giải trình chênh lệch quỹ không quá 500.000đ.

## Thêm thông số cho module sau

Đăng ký thông số mới một lần trong `SETTINGS_REGISTRY`, sau đó dùng `resolveSetting(database, key, siteId?)` tại luồng nghiệp vụ. API và màn hình portal tự đọc registry nên không cần thêm field riêng trong component. Module mới không được tạo lại hằng số nghiệp vụ trong file xử lý lệnh.
