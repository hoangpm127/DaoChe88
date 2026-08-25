# Sổ tay sự cố Đảo Chè

Phiên bản: 2026-08-21. Mục tiêu của tài liệu này là đưa hệ thống về trạng thái an toàn trước, sau đó mới tối ưu hoặc điều tra sâu.

## 1. Kênh và mức độ

| Mức | Ví dụ | Phản hồi đầu tiên | Mục tiêu khôi phục |
|---|---|---:|---:|
| SEV-1 | Không đặt được đơn, sai tiền, lộ dữ liệu, DB không sẵn sàng | 5 phút | 30 phút |
| SEV-2 | Một site không vận hành, webhook thanh toán lỗi, tồn kho sai | 15 phút | 2 giờ |
| SEV-3 | Báo cáo chậm, SSE lỗi nhưng polling còn chạy | 4 giờ | 1 ngày làm việc |

Mỗi sự cố cần một người chỉ huy, một người thao tác và một dòng thời gian. Không gửi token, mật khẩu, chuỗi kết nối, số điện thoại hoặc địa chỉ khách vào chat/log sự cố.

## 2. Kiểm tra đầu tiên

1. Gọi `GET /api/health/live`. Nếu lỗi, tiến trình/container chưa phục vụ HTTP.
2. Gọi `GET /api/health`. Đọc `checks.database.schemaVersion`, `dataIntegrity`, SePay, Lalamove, retention và monitoring.
3. Xem deployment gần nhất và log từ thời điểm deploy. Tìm theo `x-request-id` thay vì PII.
4. So sánh migration hiện tại với `POSTGRES_MIGRATION_VERSION` trong `lib/data-integrity.ts`.
5. Nếu lỗi bắt đầu ngay sau deploy, dừng rollout mới; không sửa trực tiếp dữ liệu trước khi có backup.

## 3. Deployment crash hoặc healthcheck đỏ

- Liveness phải trỏ `/api/health/live`; endpoint này không phụ thuộc DB hay nhà cung cấp ngoài.
- Readiness `/api/health` trả 503 nếu migration thiếu, toàn vẹn dữ liệu lỗi hoặc cấu hình bắt buộc chưa sẵn sàng.
- Chạy migration bằng `npm run db:migrate` trên đúng `DATABASE_URL`, rồi gọi lại readiness.
- Nếu migration không tương thích, redeploy phiên bản ứng dụng trước đó. Không dùng `git reset --hard`, không tự xóa bảng và không sửa bảng migration bằng tay.
- Khi lỗi kiểu dữ liệu, lưu câu lỗi đã khử bí mật, tên migration và số bản ghi ảnh hưởng vào timeline.

## 4. Thanh toán SePay

Alert `sepay-failures` bật khi có hơn 3 payment attempt lỗi trong 10 phút.

1. Giữ đơn ở trạng thái chờ; không tự đánh dấu đã trả tiền.
2. Kiểm tra chữ ký/API key webhook và thời gian request.
3. Đối chiếu `payment_transactions`, `payment_attempts` và sao kê theo mã thanh toán.
4. Chỉ dùng quy trình đối soát/hoàn tiền có idempotency key. Không chèn ledger thủ công.
5. Nếu nhà cung cấp gián đoạn, chuyển thông báo khách sang tiền mặt khi nghiệp vụ cho phép.

## 5. Sai tiền, quỹ hoặc công nợ

- Dừng chốt kỳ và payout liên quan.
- Xuất báo cáo chỉ đọc; đối chiếu order → payment attempt → ledger → reconciliation.
- Không sửa số tiền đơn cũ. Mọi điều chỉnh phải qua amendment/refund/correction và có audit event.
- Alert `cash-variance`, `debt-limit` và `reconciliation-overdue` chỉ được resolve sau khi chứng từ khớp.

## 6. Tồn kho sai hoặc âm

1. Tạm đóng nhận món/site stock bị ảnh hưởng.
2. Chạy health để lấy `dataIntegrity.stock` và alert `invalid-stock`.
3. Đối chiếu reservation, movement, lot consumption, transfer và stock count.
4. Sửa qua kiểm kê/phiếu chênh lệch; không `UPDATE on_hand` trực tiếp.

## 7. Đơn mới bị kẹt

Alert `orders-stuck-new` bật khi đơn ở `new` quá 15 phút.

- Kiểm tra site mở cửa, nhân sự ca, KDS và thanh toán.
- Nếu SSE lỗi, portal tự polling 30 giây; thử `/api/stream` và kiểm tra giới hạn ba kết nối/tài khoản.
- Xử lý đơn theo state machine hiện hữu; không nhảy trạng thái bằng SQL.

## 8. Sự cố dữ liệu cá nhân

1. Cô lập tài khoản hoặc route gây lộ; xoay session secret nếu phiên có nguy cơ bị chiếm.
2. Bảo toàn `pii_access_log`, request ID và event log. Không sao chép PII sang ticket.
3. Xác định loại dữ liệu, chủ thể, khoảng thời gian, người đã truy cập và nơi nhận dữ liệu.
4. Thực hiện quy trình thông báo/khắc phục theo pháp luật và tư vấn pháp lý hiện hành.
5. Yêu cầu ẩn danh hóa dùng `POST /api/privacy/customers/:id/anonymize`, chỉ owner/super-admin; số tiền và ngày kế toán được giữ nguyên.

## 9. Backup và restore

### Lịch bắt buộc

- PostgreSQL: `npm run db:backup` mỗi ngày, giữ 30 ngày.
- Railway Volume: `npm run volume:backup` mỗi ngày bằng job riêng, không gộp với DB dump.
- `BACKUP_DIRECTORY` hoặc `BACKUP_RCLONE_REMOTE` phải nằm ngoài Railway project/volume đang được bảo vệ.
- Bật snapshot/PITR của nhà cung cấp PostgreSQL nếu gói dịch vụ hỗ trợ. Đây là cấu hình hạ tầng, không thay thế dump.

### Biến môi trường

- `BACKUP_ENCRYPTION_KEY`: 32 byte base64 hoặc 64 ký tự hex, lưu trong secret manager ngoài repo.
- `BACKUP_DIRECTORY`: thư mục đích ngoài hạ tầng chính.
- `BACKUP_RCLONE_REMOTE`: đích object storage tùy chọn.
- `BACKUP_RETENTION_DAYS=30`.
- `VOLUME_BACKUP_SOURCE`: mount chứa ảnh catalog/POD.

### Restore drill hàng quý

1. Tạo PostgreSQL staging rỗng, không nối với production traffic.
2. Tải một file `.dump.enc` từ kho ngoài Railway.
3. Đặt `RESTORE_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, và `RESTORE_CONFIRM=RESTORE_DAOCHE_DATABASE`.
4. Chạy `npm run db:restore -- <file.dump.enc>`.
5. Trỏ một deployment staging vào DB vừa phục hồi, chạy migration, `/api/health`, test smoke đặt đơn test và báo cáo tài chính.
6. Ghi ngày, file, RPO thực tế, thời gian khôi phục và người xác nhận. Xóa môi trường drill sau khi hoàn tất.

## 10. Xoay secret

- Hàng quý và ngay sau nghi ngờ lộ: Railway token, DB password, `PORTAL_SESSION_SECRET`, SePay/Lalamove secrets, backup key, alert webhook.
- Xoay từng secret, deploy, kiểm tra health rồi mới thu hồi giá trị cũ.
- Đổi `PORTAL_SESSION_SECRET` làm mọi cookie hiện tại mất hiệu lực; báo trước cho đội vận hành.
- Backup key cũ phải được giữ trong secret archive cho tới khi mọi backup mã hóa bằng khóa đó hết thời hạn lưu.

## 11. Kết thúc sự cố

Chỉ đóng khi: dịch vụ đã ổn định, dữ liệu toàn vẹn, giao dịch treo đã đối chiếu, alert đã resolve, timeline đầy đủ và có hành động phòng ngừa kèm người chịu trách nhiệm/ngày hoàn thành.
