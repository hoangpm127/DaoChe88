# Hướng dẫn M2 — quản lý mạng lưới điểm bán

## 1. Thêm và cập nhật điểm bán

Đăng nhập Portal bằng tài khoản **Chủ hệ thống** hoặc vai trò được cấp quyền, mở **Phân quyền → Master data mạng lưới**.

- Chọn **Thêm điểm bán** để nhập tên, mã, loại điểm, địa chỉ, tọa độ, giờ mở cửa, bán kính phục vụ và năng lực theo giờ.
- Chọn một điểm đang có để sửa thông tin, lịch mở cửa, tọa độ hoặc bán kính.
- Dùng **Tạm đóng ngay / Mở lại** khi điểm bán ngừng hoặc nhận đơn trở lại.
- Dùng **Lên lịch nghỉ/sửa chữa** cho kỳ nghỉ có thời gian bắt đầu và kết thúc rõ ràng.

Điểm bán lẻ có trạng thái `open` xuất hiện trên `/order` ngay sau lần tải dữ liệu tiếp theo. Bếp tổng không xuất hiện trong danh sách đặt hàng của khách.

Lịch mở cửa dùng JSON theo thứ trong tuần, ví dụ:

```json
{"mon":[["06:30","22:00"]],"tue":[["06:30","22:00"]],"wed":[["06:30","22:00"]],"thu":[["06:30","22:00"]],"fri":[["06:30","22:00"]],"sat":[["07:00","23:00"]],"sun":[["07:00","23:00"]]}
```

Để trống mảng của một ngày nếu nghỉ cả ngày. Ca qua đêm được viết như `[["22:00","02:00"]]`.

## 2. Mở và chốt ca

Vai trò **Chủ cửa hàng** hoặc **Nhân viên cửa hàng** mở **Nhân sự → Quỹ ca**.

1. Chọn điểm bán và nhập tiền đầu ca, rồi bấm **Xác nhận mở ca**.
2. Cuối ca, chuyển sang **Chốt ca**, nhập số tiền đếm thực tế và ghi chú.
3. Hệ thống lưu tiền kỳ vọng và chênh lệch dưới dạng số nguyên VND.

Phần đối soát tiền mặt đầy đủ, lý do bắt buộc khi lệch và cảnh báo quản lý sẽ được hoàn thiện ở M8.

## 3. Nạp danh sách cửa hàng từ CSV

Sao chép [mẫu CSV](mau-danh-sach-cua-hang.csv), thay toàn bộ dòng `[MẪU]` bằng dữ liệu thật rồi chạy:

```powershell
npm run sites:import -- duong-dan\danh-sach-cua-hang.csv --dry-run
npm run sites:import -- duong-dan\danh-sach-cua-hang.csv
```

Lệnh thật cần `DATABASE_URL`, cập nhật theo `code` và chạy trong một transaction. Script từ chối nạp dòng mẫu vào database. `owner_phone` chỉ dùng được sau khi tài khoản chủ đã được tạo bởi M1; `partner_code` phải tồn tại trước.

## 4. Kiểm tra sau khi nhập

- Đếm đủ **23 cửa hàng đang mở + 1 bếp tổng** trong database.
- Mở `/order`, kiểm tra tên, địa chỉ, tọa độ và giờ mở của vài điểm ở các quận khác nhau.
- Đặt thử tại một điểm không thuộc ba điểm seed cũ và kiểm tra `operation_orders.site_id` đúng.
- Thử đặt ngoài giờ hoặc trong lịch đóng cửa: API phải trả `site_closed_now` và thông tin mở lại nếu có.
