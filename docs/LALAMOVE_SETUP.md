# Tích hợp Lalamove cho Đảo Chè

## Trạng thái triển khai

### Môi trường đang chạy — cập nhật 2026-08-18

- Partner Portal đã kích hoạt và Railway đang dùng API Key/Secret của môi trường **Sandbox**; khóa chỉ nằm trong biến môi trường, không ghi vào Git.
- `LALAMOVE_ENABLED=true`, `LALAMOVE_ENV=sandbox`, `ORDER_DATA_MODE=test`, `LALAMOVE_AUTO_BOOK=false`.
- Dịch vụ mặc định là `MOTORCYCLE`; ngưỡng cước tự động hiện đặt ở 30.000đ.
- Chữ ký HMAC đã được xác minh bằng một yêu cầu đọc tới API Sandbox thật.
- Webhook V3 đã đăng ký tại `https://daoche-production.up.railway.app/api/webhooks/lalamove`.
- Health production báo Lalamove `enabled=true`, `configured=true`, `credentials=true`.
- E2E Sandbox thật đã đạt ngày 2026-08-18: quote 12.000đ/500m, book nhận mã chuyến, refresh và hủy thành công; hai webhook V3 `ASSIGNING_DRIVER`/`CANCELED` đều được xác thực, lưu DB và trả HTTP 200. Không có tài xế thật và không phát sinh phí.
- Chưa go-live: còn phải cấp khóa/tín dụng Production và tách quyền cho phép đặt chuyến Production khỏi `LALAMOVE_AUTO_BOOK`, vì quy trình đã chốt là nhân viên bấm xác nhận thay vì tự động gọi tài xế.

Backend hỗ trợ đầy đủ chu trình cơ bản của Lalamove API v3:

1. Lấy báo giá theo tọa độ điểm làm món và khách nhận.
2. Lưu báo giá, phí, quãng đường và thời hạn 5 phút.
3. Đặt một chuyến duy nhất cho một đơn đã thanh toán và đã sẵn sàng.
4. Nhận webhook có chữ ký, chống xử lý trùng và bỏ qua sự kiện đến sai thứ tự.
5. Đồng bộ các trạng thái tìm tài xế, đã nhận, đã lấy món và giao xong.
6. Khi chuyến bị hủy, từ chối hoặc hết hạn, đưa đơn về hàng chờ điều phối và tạo cảnh báo; không hủy đơn món ăn.
7. Nếu `LALAMOVE_AUTO_BOOK=true`, khi món chuyển sang `ready` hệ thống chỉ tự gọi Lalamove nếu không còn shipper nội bộ `available` tại điểm làm món.
8. Sau `LALAMOVE_MATCH_TIMEOUT_MINUTES` (mặc định 5 phút) vẫn chưa có tài xế, hệ thống tạo cảnh báo điều phối để thêm phí ưu tiên hoặc chuyển phương án.
9. Khi webhook xác nhận `COMPLETED`, phí chuyến được tự ghi vào chi phí và sổ cái; nếu cao hơn phí giao đã thu của khách, tài chính nhận cảnh báo biên phí âm.

Các điểm vào backend:

- `POST /api/deliveries/lalamove` với `action=quote|book|refresh|cancel|configure-webhook` (cần phiên portal và quyền điều phối).
- `GET /api/deliveries/lalamove?orderId=...` để đọc báo giá/chuyến hiện tại.
- `POST /api/webhooks/lalamove` là URL nhận webhook từ Lalamove.

## Chế độ sandbox

Đặt các biến Railway sau:

```text
LALAMOVE_ENABLED=true
LALAMOVE_ENV=sandbox
LALAMOVE_API_KEY=pk_test_...
LALAMOVE_API_SECRET=sk_test_...
LALAMOVE_MARKET=VN
LALAMOVE_LANGUAGE=vi_VN
LALAMOVE_SERVICE_TYPE=MOTORCYCLE
LALAMOVE_AUTO_BOOK=false
ORDER_DATA_MODE=test
```

Sau khi deploy, đăng nhập portal bằng vai trò `super-admin`, gọi:

```json
{ "action": "configure-webhook" }
```

Hệ thống sẽ đăng ký chính URL `https://<domain>/api/webhooks/lalamove`, không nhận URL tùy ý từ trình duyệt.

## Chuyển sang chuyến thật

Chỉ chuyển sau khi đã chạy hết sandbox, tọa độ khách là tọa độ thật và ví production đã nạp tiền:

```text
ORDER_DATA_MODE=live
LALAMOVE_ENV=production
LALAMOVE_API_KEY=pk_prod_...
LALAMOVE_API_SECRET=sk_prod_...
LALAMOVE_AUTO_BOOK=true
```

Ba chốt này phải đồng thời đúng. Khóa production không thể tạo chuyến khi `ORDER_DATA_MODE=test`; khóa sandbox/production sai tiền tố cũng bị từ chối.

## Mốc thời gian nên thông báo cho khách

- Thời gian bếp: 8–12 phút.
- Gọi Lalamove: khoảng 8–10 phút trước lúc món sẵn sàng; báo giá chỉ giữ 5 phút nên không lấy giá quá sớm.
- Ngân sách tìm tài xế: 5 phút. Nếu vẫn `ASSIGNING_DRIVER`, điều phối viên nhận cảnh báo để thêm ưu tiên hoặc chuyển ship nội bộ.
- Tài xế tới điểm lấy: thường dự phòng 5–12 phút, tùy vị trí và thời tiết.
- Giao trong bán kính ngắn nội thành: dự phòng 10–25 phút.
- Cam kết phù hợp khi vận hành thử: 30–45 phút từ lúc xác nhận thanh toán; giờ cao điểm/mưa nên hiển thị 45–60 phút.

Mốc “từ 10 giây” của Lalamove chỉ là khả năng ghép tài xế nhanh nhất họ công bố, không phải thời gian bảo đảm. API cho phép đơn tức thời tiếp tục ở trạng thái tìm tài xế và về mặt kỹ thuật có thể hết hạn sau 2 giờ, nên hệ thống không chờ đến ngưỡng đó mới xử lý.

## Chi phí

Lalamove không công bố phí tích hợp API hay phí thuê bao tháng. Khi đặt chuyến production, phí chuyến được trừ từ ví Lalamove. Giá là giá động theo thời điểm, quãng đường và dịch vụ; phí ưu tiên, chờ hoặc hủy có thể phát sinh theo điều kiện áp dụng. Sandbox không tạo tài xế thật và không trừ phí chuyến thật.
