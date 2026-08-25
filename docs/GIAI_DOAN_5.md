# Giai đoạn 5 — trạng thái triển khai

Ngày cập nhật: 2026-08-21.

## Đã triển khai trong mã nguồn

- API scoped và cursor: orders/list/detail, alerts, inventory, staff, finance summary/ledger.
- `/api/operations` còn là lớp tương thích mỏng nhưng đọc trực tiếp bằng SQL `WHERE`; không còn lọc snapshot toàn hệ thống trong main path và không cắt 50 đơn toàn cục.
- SSE `/api/stream`, poll event mỗi giây, giới hạn kết nối dùng DB; portal đóng kết nối khi tab ẩn và fallback polling 30 giây.
- Rate limit công khai dùng bucket PostgreSQL theo hash IP và user ID khi có.
- Composite/partial index cho orders, ledger, stock và alerts; catalog/sites hỗ trợ ETag.
- Request ID và security headers; runtime error webhook, incident monitor và owner monitoring API.
- Audit truy cập PII, ẩn danh hóa khách giữ nguyên dữ liệu kế toán, retention job, điều khoản/chính sách và timestamp đồng ý.
- Backup/restore PostgreSQL và volume có AES-256-GCM, retention 30 ngày, health check sau deploy, load test và CI audit.
- Backfill khách cũ đã bỏ truy vấn một lần cho mỗi đơn.

## Cần vận hành ngoài mã nguồn

- Cấu hình kho backup thực sự nằm ngoài Railway và chạy scheduler hàng ngày.
- Bật PITR/snapshot trên nhà cung cấp PostgreSQL, nếu gói hỗ trợ.
- Thực hiện restore drill trên staging và ghi biên bản hàng quý.
- Cấu hình `OPERATIONS_ALERT_WEBHOOK_URL`, diễn tập một alert từ phát hiện đến resolve.
- Chạy `npm run test:load:phase5` đủ 30 phút với 23 cửa hàng × 5 thiết bị trên staging có dữ liệu gần production; yêu cầu p95 < 300 ms và lỗi < 1%.
- Thực hiện một ca staging đầy đủ: đặt món → thanh toán → bếp → giao → đối soát → báo cáo → đóng kỳ.

Không đánh dấu các đầu việc trên là hoàn tất chỉ vì script đã tồn tại; chúng cần bằng chứng từ hạ tầng và vận hành thật.
