# Tào Phớ 88

Webapp ưu tiên điện thoại cho đặt món và vận hành chuỗi Tào Phớ 88. Hệ thống dùng **6 không gian làm việc cho 17 vai trò**, thay vì duy trì 17 ứng dụng riêng.

## Không gian làm việc

| Không gian | Vai trò | Lối vào |
| --- | --- | --- |
| Khách hàng & Cộng đồng | Khách, khách có hồ sơ, thành viên/chủ đơn nhóm, Affiliate | `/order` |
| Đối tác & Phát triển điểm | Ứng viên, đối tác phân phối, chủ mở điểm | `/order`, `/portal` |
| Vận hành cửa hàng | Nhân viên, quản lý cửa hàng | `/portal` |
| Giao nhận | Shipper, điều phối | `/portal` |
| Sản xuất & Mạng lưới | Bếp tổng, quản lý vùng | `/portal` |
| Tài chính, Kiểm soát & Hệ thống | Tài chính, kiểm soát nội bộ, Super Admin | `/portal` |

Chi tiết ánh xạ, nguyên tắc quyền và kịch bản test nhiều thiết bị nằm trong [`docs/ROLE_WORKSPACES.md`](docs/ROLE_WORKSPACES.md).

## Chạy cục bộ

Yêu cầu Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
```

Portal cần hai biến môi trường:

```text
PORTAL_SESSION_SECRET=<chuỗi bí mật tối thiểu 32 ký tự>
PORTAL_DEMO_ACCESS_CODE=<mã demo tối thiểu 8 ký tự>
SQLITE_PATH=./data/taopho88.sqlite
ALLOW_MEMORY_FALLBACK=false
DEMO_SEED=false
```

Dữ liệu vận hành dùng SQLite bền vững khi có `SQLITE_PATH` hoặc `DATABASE_PATH`. Chỉ bật `ALLOW_MEMORY_FALLBACK=true` và `DEMO_SEED=true` trong môi trường demo/test; production mặc định không tự chèn dữ liệu mẫu.

## Thực đơn, giá và tồn món

- `GET /api/catalog?siteId=<mã điểm>` trả thực đơn, topping, giá backend và số lượng khả dụng của điểm bán.
- `catalog_products` và `catalog_product_options` là nguồn giá phía máy chủ; tên hoặc giá do trình duyệt gửi lên không được dùng để tính tiền.
- Mỗi dòng đơn lưu riêng giá gốc, tiền topping, đơn giá cuối, thành tiền và JSON tùy chọn tại thời điểm mua để các lần đổi giá sau không làm sai lịch sử.
- `catalog_site_stock` chỉ chặn theo số lượng khi `track_stock=1`. Tạo đơn giữ tồn, hủy/hoàn tiền trả tồn, giao xong trừ tồn; mọi thay đổi có reservation và movement để đối soát.
- Mã `TEST-SEPAY-2K` chỉ xuất hiện và được đặt khi `ORDER_DATA_MODE=test`.

## Toàn vẹn dữ liệu production

- Schema vận hành hiện tại là version 13; healthcheck chỉ báo sẵn sàng khi không có sai lệch tiền đơn, dòng món, thanh toán, khách hàng, giao nhận, kho hoặc phân bổ tài chính.
- `customers` chuẩn hóa điện thoại Việt Nam về dạng `+84…`, tách tuyệt đối bản ghi `test` và `live`, không tự coi khách vãng lai là tài khoản đã xác minh.
- `order_fulfillment_details` đóng băng người nhận, điện thoại, địa chỉ có cấu trúc, tọa độ và thông tin điểm lấy hàng theo từng đơn để thay đổi hồ sơ sau này không sửa lịch sử.
- Mỗi đơn mới ghi `data_schema_version=13`; đơn test cũ được backfill an toàn nhưng vẫn giữ nguyên cờ test và phiên bản dữ liệu ban đầu.
- Trigger SQLite chặn tổng tiền sai, dòng món sai phép tính, dòng món mồ côi và payment attempt không có đơn tương ứng.

## Mô hình quyền

- API lấy vai trò từ cookie phiên được ký, `HttpOnly`, `SameSite=Strict`, hết hạn sau 8 giờ.
- `role` trong URL và `actor` trong JSON không cấp quyền.
- Snapshot được lọc ở máy chủ theo địa điểm, đối tác, thành viên và capability.
- Khách chỉ được tạo đơn công khai; mọi lệnh vận hành cần phiên portal hợp lệ.
- Tài chính không tự sửa chính sách 20/40/60; quyền này chỉ thuộc Super Admin trong bản demo.
- Service worker không chặn hoặc lưu cache `/portal`, `/api`, auth hay session.

## Kiểm thử

`npm test` build production và chạy toàn bộ bộ test:

- HTML/responsive baseline;
- session ký và đăng xuất;
- chống giả vai trò qua URL/body;
- phạm vi dữ liệu cửa hàng, shipper, tài chính và kiểm soát;
- đồng bộ SQLite/API;
- giá/topping do backend tính, giữ–trả–trừ tồn món;
- chính sách cache PWA an toàn.

## Triển khai

- Railway chạy `npm run build` và `npm start` theo `railway.toml`.
- Railway cần gắn volume tại `/data`, đặt `SQLITE_PATH=/data/taopho88.sqlite`, `ALLOW_MEMORY_FALLBACK=false`, `DEMO_SEED=false`, cùng hai bí mật portal ở trên.
- Healthcheck production dùng `GET /api/health`; endpoint chỉ trả `200` khi SQLite, schema hiện hành và cấu hình phiên portal đều sẵn sàng.
- `.openai/hosting.json` khai báo dự án Sites và binding D1.
- Không đưa `PORTAL_SESSION_SECRET` vào Git; cấu hình bằng biến môi trường của nền tảng triển khai.
