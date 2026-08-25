# Kế hoạch phát triển Đảo Chè — từ bản demo gọi vốn thành phần mềm vận hành thật

> Phạm vi: **backend + database + luồng dữ liệu nghiệp vụ**. Giữ nguyên UI/UX hiện có của `/order` và `/portal`; chỉ thay nguồn dữ liệu và bổ sung màn hình khi backend bắt buộc phải có chỗ nhập liệu.
>
> Tài liệu này chia công việc thành **15 module (M0–M14)**. Hoàn thành hết 15 module thì hệ thống chạy thật được cho 23 cửa hàng + 1 bếp tổng.
>
> Ngày lập: 2026-08-16 · Cập nhật: 2026-08-16 (chốt quyết định kiến trúc) · Nhánh tham chiếu: `claude` · Commit gần nhất: `4f27663`

## Nhật ký quyết định

| Ngày | Quyết định | Ảnh hưởng |
| --- | --- | --- |
| 2026-08-16 | **Q1 — PostgreSQL trên Railway.** Chủ hệ thống cấp Railway project token khi làm M0. | M0 chuyển từ tùy chọn sang bắt buộc chuyển đổi; ước lượng 2–3 → 4–5 người-tuần |
| 2026-08-16 | **Q2 + Q3 — Xác thực truyền thống: SĐT + mật khẩu.** eSMS gửi OTP cho đăng ký và quên mật khẩu. Áp dụng cho cả nhân viên lẫn khách hàng. | Viết lại M1: mật khẩu là chính, OTP chỉ dùng 2 trường hợp; thêm luồng quên mật khẩu; tích hợp eSMS |
| 2026-08-16 | **Q5 — ~~Cloudflare R2~~ → đổi thành Railway Volume.** | M3, M7, M8, M9 — kèm cảnh báo dung lượng ảnh POD ở mục 3.2 |
| 2026-08-16 | **Q6 — Hóa đơn điện tử: hoãn.** Giữ trong kế hoạch, không làm ở đợt này. | M10 giữ schema + interface, cài đặt để trống; **vẫn phải xuất hóa đơn bằng cách hiện hành khi bán thật** |
| 2026-08-16 | **Q7 — Bỏ hoàn toàn memory fallback.** | M0 xóa ~600 dòng |
| 2026-08-16 | **Q8 — Rút xuống 7 vai trò.** | M1 ánh xạ vai trò cũ ở tầng API |
| 2026-08-16 | **Phần 6 — Thông số phải do admin tự chỉnh trong phần mềm**, không nhận file dữ liệu từ chủ hệ thống. | **Thêm M14 — Bảng cấu hình hệ thống**; số module 14 → 15 |
| *chưa chốt* | **Q4 — SSE thay polling.** Quyết định kỹ thuật, không cần chủ hệ thống duyệt. Giữ đề xuất SSE. | M12 |
| 2026-08-16 | **Q9 — Bỏ toàn bộ Cloudflare. Tất cả chạy trên Railway.** Bỏ D1, bỏ R2, bỏ Workers runtime. | M0 **rẻ đi**: chỉ còn một phương ngữ SQL, gỡ `cloudflare:workers` khỏi mọi lib, bỏ shim test |
| 2026-08-16 | **Ảnh và file lưu trên Railway Volume**, không dùng R2. | M3, M7, M8, M9 — xem cảnh báo dung lượng ở mục 3.2 |
| 2026-08-16 | **Brandname eSMS chưa được duyệt → tạm bỏ OTP.** Đăng ký và quên mật khẩu không dùng OTP ở đợt này. | M1 **giảm phạm vi**, nhưng **đổi cách khôi phục mật khẩu** — xem mục 3.3 |
| 2026-08-16 | **Tất cả cửa hàng dùng chung một tài khoản SePay.** | M2 bỏ cột `sepay_sub_account`; M8 bỏ phần khớp sub-account |
| 2026-08-16 | **Có kế toán riêng** → giữ vai trò `accountant` tách bạch. | M1 — bỏ ghi chú "có thể gộp vào owner" |

---

## 0. Tóm tắt điều hành

### 0.1. Bản demo hiện tại thực sự đang ở đâu

Đây **không phải** một bản demo rỗng. Có một lượng backend thật đáng kể đã chạy được:

| Đã làm thật, dùng lại được | Vị trí |
| --- | --- |
| Phiên portal ký HMAC, `HttpOnly`, hết hạn 8 giờ, chống giả role qua URL/body | `lib/portal-session.ts`, `app/api/portal-session/route.ts` |
| Giá và topping tính hoàn toàn phía server từ `catalog_products` | `lib/catalog-store.ts`, `lib/operations-store.ts:2012` |
| Giữ – trả – trừ tồn món có reservation + movement để đối soát | `lib/operations-store.ts:2323`, `:2480`, `:2493` |
| Thanh toán VietQR/SePay: tạo mã, webhook có HMAC + chống replay, quét đơn hết hạn | `lib/sepay.ts`, `app/api/webhooks/sepay/route.ts` |
| Hoàn tiền toàn phần + hủy đơn có khóa lạc quan (optimistic concurrency) | `lib/operations-store.ts:2675` |
| Ship ngoài qua Lalamove: quote, book, webhook, timeout fallback | `lib/delivery-store.ts`, `lib/lalamove.ts` |
| Sổ cái tài chính, phân bổ 20/40/60 theo basis point, không dùng số thực | `lib/operations-store.ts:603` |
| Trigger SQLite chặn tổng tiền sai, dòng món mồ côi, payment không có đơn | `lib/data-integrity.ts:225` |
| Chuẩn hóa SĐT `+84`, tách tuyệt đối dữ liệu `test`/`live` | `lib/data-integrity.ts:73` |
| Nhật ký sự kiện bất biến cho mọi chuyển trạng thái | bảng `operation_event_log` |
| Healthcheck chặn deploy khi dữ liệu lệch | `app/api/health/route.ts` |

**Kết luận:** phần "một đơn hàng lẻ đi từ giỏ hàng đến khi giao xong và ghi sổ" đã gần đạt chất lượng production. Đó là khoảng 35–40% khối lượng.

### 0.2. Vì sao vẫn chưa vận hành thật được

Ba khoảng trống lớn, xếp theo mức nghiêm trọng:

1. **Không có bếp tổng trong phần mềm.** Nghiệp vụ lõi của anh — bếp tổng sản xuất rồi phân phối cho 23 cửa hàng — **hoàn toàn không tồn tại** trong code. Không có mẻ sản xuất, không có phiếu điều chuyển, không có nhập kho tại cửa hàng, không có giá vốn thật. Giá vốn 20% hiện là **một con số phần trăm bịa ra** nhân với giá bán (`lib/operations-store.ts:612`), không phải chi phí thật.
2. **Không có danh tính người dùng.** Cả hệ thống dùng **một mã truy cập dùng chung** (`PORTAL_DEMO_ACCESS_CODE`). Ai biết mã đó thì chọn được vai trò bất kỳ, kể cả Super Admin (`app/api/portal-session/route.ts:64`). Phạm vi cửa hàng cũng **hardcode trong file** — vai trò `store` luôn gắn cứng `site-my-dinh` (`lib/portal-access.ts:76`). Với 23 cửa hàng, mô hình này không dùng được một ngày nào.
3. **Không có master data.** Database chỉ có **4 điểm bán** (đều là dữ liệu mẫu, và seed bị tắt ở production). Giao diện lại hiển thị **36 điểm bán hardcode trong file TSX** (`app/order/page.tsx:766`). Khi khách bấm đặt hàng, cả 36 điểm bị ép về **đúng 3 mã điểm** (`app/order/page.tsx:1934`). Không có lệnh nào để tạo cửa hàng, tạo nhân viên, hay sửa giá — nghĩa là trên production sạch, hệ thống có **0 cửa hàng** và **không có cách nào tạo ra cửa hàng**.

### 0.3. Ước lượng tổng thể

| Giai đoạn | Module | Ước lượng | Kết quả đạt được |
| --- | --- | --- | --- |
| 1. Nền tảng | M0, M1, M2 | 8–11 người-tuần | Chuyển Postgres xong, có tài khoản thật, có 23 cửa hàng thật trong DB |
| 2. Bán được hàng | M3, M4, M14, M8, M9 | 9–14 người-tuần | Một cửa hàng bán thật, thu tiền thật, giao thật; admin tự chỉnh mọi thông số |
| 3. Chuỗi vận hành | M7, M10 | 8–11 người-tuần | Bếp tổng chạy, tài chính đúng, đối soát được |
| 4. Tăng trưởng | M5, M6, M11 | 7–10 người-tuần | Đơn nhóm, affiliate, loyalty chạy thật |
| 5. Quy mô & an toàn | M12, M13 | 5–7 người-tuần | Chịu tải 23 điểm, có backup, có giám sát |
| **Tổng** | | **37–53 người-tuần** | |

Con số này là ước lượng thô cho một đội 2–3 người full-stack. Giai đoạn 1 + 2 (khoảng 17–25 người-tuần) là **mức tối thiểu để mở bán thật ở 1–2 cửa hàng thí điểm**.

*So với bản đầu: +3–4 người-tuần, do chốt chuyển PostgreSQL (M0) và thêm M14 để mọi thông số nghiệp vụ do admin tự chỉnh.*

---

## 1. Mô hình nghiệp vụ mục tiêu

Chốt lại theo mô tả của anh, để mọi module bám vào một mô hình duy nhất:

```
                        ┌──────────────────────────┐
                        │   ADMIN TỔNG (chủ hệ)    │
                        │  sở hữu bếp tổng + chuỗi │
                        └────────────┬─────────────┘
                                     │
              ┌──────────────────────┴──────────────────────┐
              │                                             │
     ┌────────▼─────────┐                        ┌──────────▼──────────┐
     │    BẾP TỔNG      │  điều chuyển hàng      │   23 CỬA HÀNG       │
     │  - sản xuất mẻ   │ ─────────────────────► │  - chính thống      │
     │  - kho thành phẩm│  (phiếu xuất/nhập)     │  - đối tác phân phối│
     │  - kho nguyên liệu│                       └──────────┬──────────┘
     └──────────────────┘                                   │
                                          ┌─────────────────┼─────────────────┐
                                          │                 │                 │
                                   ┌──────▼─────┐   ┌───────▼──────┐  ┌───────▼──────┐
                                   │ CHỦ CỬA HÀNG│   │ NHÂN VIÊN    │  │  KHÁCH HÀNG  │
                                   │ - P&L điểm  │   │ - nhận đơn   │  │ - đặt lẻ     │
                                   │ - nhập hàng │   │ - làm món    │  │ - đặt nhóm   │
                                   │ - chi phí   │   │ - thu tiền   │  │ - affiliate  │
                                   └─────────────┘   └──────────────┘  └──────────────┘
```

### 1.1. Vai trò thật cần có (7 vai trò, không phải 17)

Tài liệu `docs/ROLE_WORKSPACES.md` đang mô tả **17 vai trò / 6 workspace**. Với mô hình thật của anh, con số đó là thừa và làm phức tạp phân quyền vô ích. Đề xuất rút gọn:

| Mã vai trò | Tên | Phạm vi dữ liệu | Ghi chú |
| --- | --- | --- | --- |
| `owner` | Admin tổng / Super Admin | Toàn hệ thống | Chính là anh |
| `kitchen` | Quản lý bếp tổng | Bếp tổng + tất cả phiếu điều chuyển | Sản xuất, xuất hàng |
| `store-owner` | Chủ cửa hàng | Đúng các cửa hàng được gán | Gồm cả chủ điểm đối tác phân phối |
| `store-staff` | Nhân viên bán hàng | Đúng cửa hàng đang trực ca | Nhận đơn, làm món, thu tiền |
| `shipper` | Shipper | Đúng các đơn được gán cho mình | Có thể là nhân sự của cửa hàng |
| `accountant` | Kế toán / đối soát | Toàn hệ thống, chỉ đọc + duyệt chi | ✅ Đã chốt: **có kế toán riêng**, giữ vai trò tách bạch |
| `affiliate` | Cộng tác viên / chủ phòng nhóm | Chỉ dữ liệu hoa hồng của chính mình | Đăng nhập ở phía khách, không vào portal |

Các vai trò `distribution`, `dispatch`, `founder`, `manager`, `region-manager`, `finance`, `control` trong `lib/portal-access.ts` hoặc được ánh xạ về 7 vai trò trên, hoặc bỏ. **Quan trọng:** giữ nguyên UI hiện tại bằng cách ánh xạ vai trò cũ → vai trò mới ở tầng API, không phải viết lại giao diện.

### 1.2. Ba dòng tiền phải chảy đúng

1. **Dòng bán lẻ:** Khách → Cửa hàng (tiền mặt / VietQR) → Ghi nhận doanh thu cho cửa hàng.
2. **Dòng nội bộ:** Bếp tổng xuất hàng → Cửa hàng nhận hàng → **Công nợ nội bộ** (cửa hàng nợ bếp tổng theo giá giao). Đây là dòng tiền **hiện chưa tồn tại**.
3. **Dòng hoa hồng:** Đơn có mã giới thiệu (affiliate hoặc chủ phòng nhóm) → trích % → tích lũy → chi trả theo kỳ.

---

## 2. Đánh giá hiện trạng chi tiết

### 2.1. Ma trận: cái gì thật, cái gì là demo

| Khối chức năng | Frontend | Backend | Database | Đánh giá |
| --- | --- | --- | --- | --- |
| Thực đơn, giá, topping | ⚠️ hardcode 12 món trong TSX | ✅ đọc từ DB | ✅ `catalog_products` | **Lệch nguồn** — UI không gọi `/api/catalog` |
| Điểm bán | ❌ hardcode 36 điểm trong TSX | ⚠️ chỉ đọc, không tạo được | ⚠️ chỉ 4 điểm mẫu | **Hỏng** |
| Đặt đơn lẻ | ✅ gọi API thật | ✅ đầy đủ | ✅ | **Tốt** |
| Thanh toán VietQR | ✅ | ✅ | ✅ | **Tốt** |
| Thanh toán tiền mặt | ✅ | ⚠️ ghi nhận khi giao xong | ⚠️ không có quỹ ca | **Thiếu đối soát tiền mặt** |
| Theo dõi đơn | ✅ token thật | ✅ | ✅ | **Tốt** |
| Đơn nhóm | ✅ phòng thật, 5 phút | ⚠️ chốt phòng chỉ đổ vào giỏ | ❌ không sinh đơn nhóm | **Hỏng giữa chừng** |
| Affiliate | ⚠️ token trong localStorage | ✅ đăng ký → duyệt → mã → hoa hồng | ✅ | **Gần đủ, thiếu đăng nhập** |
| Hoa hồng chủ phòng nhóm | ❌ | ❌ | ❌ | **Chưa có** |
| Loyalty / điểm thưởng | ❌ hiển thị số giả | ❌ | ❌ | **Chưa có** |
| Voucher / ưu đãi | ❌ tab "Ưu đãi" toàn số giả | ❌ | ❌ | **Chưa có** |
| Thông báo | ❌ 6 thông báo hardcode | ❌ | ❌ | **Chưa có** |
| Đánh giá sản phẩm | ❌ rating/reviews hardcode | ❌ | ❌ | **Chưa có** |
| Bếp: hàng đợi món | ⚠️ dùng chung snapshot | ⚠️ `kitchen_status` có nhưng thô | ⚠️ | **Sơ khai** |
| **Bếp tổng: sản xuất** | ❌ | ❌ | ❌ | **Chưa có — nghiệp vụ lõi** |
| **Bếp tổng: điều chuyển** | ❌ | ❌ | ❌ | **Chưa có — nghiệp vụ lõi** |
| Kho nguyên liệu | ⚠️ chỉ chỉnh tay | ⚠️ `inventory.adjust` | ✅ `operation_inventory` | **Sơ khai** |
| Kho thành phẩm tại điểm | ⚠️ | ✅ giữ/trả/trừ tồn | ✅ `catalog_site_stock` | **Tốt nhưng không ai nạp hàng vào** |
| Nhân sự | ❌ danh sách hardcode theo vai trò | ⚠️ chỉ bật/tắt trạng thái | ⚠️ `operation_staff` | **Thiếu CRUD** |
| Ca làm việc | ❌ | ❌ | ❌ | **Chưa có** |
| Chi phí | ✅ form thật | ✅ tạo + duyệt | ✅ | **Tốt** |
| Báo cáo tài chính | ❌ **trộn số thật với số bịa** | ⚠️ tính từ sổ cái | ✅ | **Nguy hiểm** |
| Công nợ đối tác | ❌ hiển thị "12,8tr" hardcode | ❌ | ❌ | **Chưa có** |
| Đối soát ngân hàng | ❌ | ⚠️ khớp theo mã thanh toán | ✅ `payment_transactions` | **Thiếu báo cáo đối soát** |
| Hóa đơn điện tử / thuế | ❌ | ❌ | ❌ | **Chưa có — bắt buộc pháp lý** |
| Đăng nhập portal | ⚠️ nhập mã dùng chung | ❌ không có tài khoản | ❌ không có bảng user | **Hỏng** |
| Đăng nhập khách hàng | ❌ | ⚠️ chỉ có ChatGPT header | ❌ | **Chưa có** |

### 2.2. 13 vấn đề gốc rễ (kể cả những thứ chưa lộ ra)

Phần này liệt kê các vấn đề mà chỉ đọc code mới thấy — anh nói "còn rất nhiều vấn đề mà tôi chưa nhận ra được", đây là chúng.

#### V1 — Giá vốn là số bịa, nên toàn bộ báo cáo lợi nhuận sai

`calculateAllocation()` (`lib/operations-store.ts:612`) tính:
```ts
workshopCost = grossRevenue * policy.workshopCostBps / policy.retailBps   // = 20% giá bán
```
Đây là **tỷ lệ chính sách**, không phải chi phí thật. Ly chè bưởi Năm Roi 28.000đ và combo 498.000đ đều bị gán giá vốn đúng 20%. Khi giá nguyên liệu tăng, báo cáo vẫn hiển thị biên lợi nhuận 60% không đổi. **Không thể ra quyết định kinh doanh bằng con số này.** Cần giá vốn thật từ M7.

#### V2 — Giao diện portal trộn dữ liệu thật với dữ liệu bịa

`buildFinanceFallback()` (`app/portal/page.tsx:985`) sinh ra doanh thu, chi phí, biểu đồ 14 ngày, danh sách chi phí "EXP-DEMO-104"… rồi merge với dữ liệu backend (`:1731`). Nếu backend trả mảng rỗng (đúng như production sạch), **UI hiển thị số bịa mà không có cảnh báo nào**. Kế toán nhìn vào sẽ tin đó là số thật. Đây là rủi ro nghiêm trọng nhất về mặt niềm tin dữ liệu.

Tệ hơn: `grossRevenue = Math.max(orderRevenue, seededProductRevenue)` (`:989`) — doanh thu thật **bị thay bằng số bịa** nếu số bịa lớn hơn.

#### V3 — Không có idempotency thật khi tạo đơn

`clientReference` được nhận và lưu, nhưng index `operation_orders_client_reference_idx` (`db/schema.ts:199`) **không unique**. Khách bấm "Đặt đơn" hai lần, hoặc mạng chập chờn khiến trình duyệt retry → **hai đơn, hai mã QR, hai lần giữ tồn**. Rate limit 12 đơn/10 phút không cứu được trường hợp này.

#### V4 — Snapshot API kéo toàn bộ database mỗi 15 giây, mỗi thiết bị

`getOperationsSnapshot` → `d1Snapshot` (`lib/operations-store.ts:1395`) chạy 13 truy vấn `SELECT *` không có `WHERE`, lấy **toàn bộ** cửa hàng, nhân sự, đối tác, 50 đơn gần nhất, 400 dòng phân bổ, 400 bút toán sổ cái… rồi mới **lọc theo vai trò trong bộ nhớ** (`scopeSnapshot`, `:1349`).

Hệ quả với 23 cửa hàng:
- Một nhân viên ở Hà Đông vẫn kéo về toàn bộ dữ liệu 23 điểm rồi mới lọc bỏ.
- Portal chỉ nhìn thấy **50 đơn gần nhất toàn hệ thống**. Giờ cao điểm, 23 cửa hàng sinh 50 đơn trong vài phút → cửa hàng nào chậm tay là **đơn của mình biến mất khỏi màn hình**.
- 20 thiết bị × poll 15 giây = 80 lần quét toàn bảng mỗi phút.

Đây là lỗi kiến trúc, không phải lỗi tối ưu.

#### V5 — Rate limit và phiên không sống sót qua nhiều instance

`lib/rate-limit.ts` dùng `Map` trong bộ nhớ tiến trình. Chạy 2 instance trên Railway → giới hạn nhân đôi, và restart là mất sạch. Chặn brute-force mã portal (`MAX_FAILURES = 8`) trở nên vô nghĩa.

#### V6 — SQLite một file = một instance, không backup, không scale

`db/runtime-database.ts` mở một file SQLite trên volume Railway. Không thể chạy nhiều instance (ghi đồng thời sẽ khóa). Không có backup tự động, không có point-in-time recovery. Với dữ liệu tiền bạc của 23 cửa hàng, đây là rủi ro mất dữ liệu không chấp nhận được. **Cần quyết định kiến trúc ở M0.**

#### V7 — Hai bản cài đặt nghiệp vụ song song, chắc chắn sẽ lệch

`executeD1()` (650 dòng, `:2226`) và `executeMemory()` (357 dòng, `:2875`) cài đặt **cùng một bộ 16 lệnh nghiệp vụ hai lần**. Mỗi lần sửa logic phải sửa hai chỗ. Đọc kỹ đã thấy khác biệt (bản memory không có phần lớn kiểm tra tồn kho và ràng buộc đồng thời). Đây là nợ kỹ thuật sinh lỗi âm thầm.

#### V8 — Phạm vi cửa hàng hardcode trong mã nguồn

`lib/portal-access.ts:76` — vai trò `store` gắn cứng `siteIds: ["site-my-dinh"]`. Muốn thêm cửa hàng thứ 5 phải **sửa code và deploy lại**. Với 23 cửa hàng và nhân sự thay đổi liên tục, mô hình này không dùng được.

#### V9 — Đơn nhóm không bao giờ thành đơn nhóm

`finalizeGroupRoom()` (`app/order/page.tsx:2269`) chốt phòng rồi **đổ hết món vào giỏ hàng của chủ phòng**, sau đó đặt như một đơn lẻ với `channel: "webapp"`. Kết quả:
- Không có liên kết phòng ↔ đơn hàng.
- Không biết món nào của ai (tem tên là tính năng bán hàng chính lại không có dữ liệu).
- Không chia tiền theo người.
- **Chủ phòng không nhận được đồng hoa hồng nào** — trái với mô hình anh mô tả.
- Phòng hết hạn sau **5 phút** (`app/api/group-rooms/route.ts:129`), quá ngắn cho đơn văn phòng đặt trước.

#### V10 — Khách hàng không có tài khoản

`customers` được suy ra từ SĐT trên đơn, không có mật khẩu/OTP. Lịch sử đơn hàng lưu trong `localStorage` (`app/order/page.tsx:1405`). Đổi máy là mất sạch. Địa chỉ đã lưu gắn với **cookie thiết bị** (`app/api/group-profiles/route.ts:43`). Affiliate đăng nhập bằng token cất trong `localStorage` (`:1410`) — mất máy là mất tài khoản hoa hồng.

#### V11 — Phí giao hàng là hằng số trong code

`deliveryFeeFor()` (`lib/operations-store.ts:2084`): 15.000đ nếu đơn dưới 300.000đ, ngược lại miễn phí. Không theo khoảng cách, không theo điểm bán, không theo giờ cao điểm, không cấu hình được. Trong khi Lalamove trả về phí thật thì phí đó **không được dùng để tính tiền khách**.

#### V12 — Lệnh `order.dispatch-external` khai báo nhưng không tồn tại

Có trong danh sách `OperationsCommand` (`:45`) và trong capability của 4 vai trò, nhưng `executeD1` **không xử lý** — gửi lệnh này tới `/api/operations` sẽ nhận `"Command chưa được hỗ trợ"`. Thực tế nó nằm ở route riêng `/api/deliveries/lalamove`. Bất nhất kiểu này sẽ sinh lỗi khi UI gọi sai.

#### V13 — Schema có hai nguồn sự thật

`db/schema.ts` (Drizzle) và `ensureD1Schema()` / `ensureCatalogSchema()` / `ensureProductionDataSchema()` (raw SQL `CREATE TABLE IF NOT EXISTS`) mô tả cùng một schema hai lần. Thư mục `drizzle/` có 8 file migration nhưng **runtime không chạy chúng** — nó tự tạo bảng bằng SQL thô mỗi request. Hai nguồn này sẽ lệch nhau, và đã bắt đầu lệch (`data_schema_version` default 12 trong Drizzle, ghi 13 trong code).

Ngoài ra, việc chạy `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` + `ALTER TABLE` **trên mỗi request đầu tiên của mỗi instance** là tốn kém và rủi ro.

---

## 3. Kiến trúc mục tiêu và các quyết định cần chốt

### 3.1. Quyết định kiến trúc — đã chốt

| # | Quyết định | **Chốt** | Ảnh hưởng thi công |
| --- | --- | --- | --- |
| Q1 | Database production | ✅ **PostgreSQL trên Railway** | M0 bắt buộc chuyển đổi. Railway project token do chủ hệ thống cấp khi bắt đầu M0. Đường chạy SQLite chỉ giữ cho test cục bộ. |
| Q2 | Xác thực portal | ✅ **SĐT + mật khẩu**; eSMS gửi OTP cho **đăng ký** và **quên mật khẩu** | M1 viết lại: mật khẩu là cơ chế đăng nhập chính, OTP không dùng để đăng nhập thường ngày. |
| Q3 | Xác thực khách hàng | ✅ **SĐT + mật khẩu**, cùng cơ chế với nhân viên. Guest checkout vẫn giữ. | M11 dùng chung hạ tầng của M1, không cần luồng riêng. |
| Q4 | Realtime portal | ⚙️ Giữ đề xuất **SSE** — quyết định kỹ thuật, không cần chủ hệ thống duyệt | M12 |
| Q5 | Ảnh & chứng từ | ✅ **Railway Volume** — đã bỏ Cloudflare R2 | M3, M7, M8, M9. Qua `lib/storage.ts` để đổi được về sau. **Xem cảnh báo dung lượng mục 3.2.** |
| Q6 | Hóa đơn điện tử | ⏸️ **Hoãn** — giữ trong kế hoạch, không làm đợt này | M10 làm schema + interface, để trống phần cài đặt nhà cung cấp. |
| Q7 | Memory fallback | ✅ **Bỏ hoàn toàn** | M0 xóa `executeMemory`, `createSeedState`, cờ `ALLOW_MEMORY_FALLBACK` (~600 dòng). |
| Q8 | Số vai trò | ✅ **7 vai trò** (mục 1.1) | M1 ánh xạ 11 vai trò cũ ở tầng API, không sửa giao diện. |
| Q9 | Bỏ luôn đường chạy Cloudflare? | ✅ **Bỏ toàn bộ Cloudflare. Tất cả trên Railway.** | Gỡ D1, R2, `cloudflare:workers`, shim test. **M0 rẻ đi** dù thêm Postgres. |

#### 3.2. Q9 và lưu trữ file — ý kiến của tôi

**Đồng ý bỏ Cloudflare, đây là quyết định đúng.** Nó loại bỏ đúng vấn đề đã khiến anh đồng ý bỏ memory fallback ở Q7: bớt một phương ngữ SQL phải giữ đồng bộ, gỡ được `import { env } from "cloudflare:workers"` khỏi `lib/sepay.ts`, `lib/portal-session.ts`, `lib/operations-store.ts`, `lib/lalamove.ts`, `db/runtime-database.ts`, và bỏ được `scripts/cloudflare-workers-loader.mjs`. M0 **đơn giản hơn** so với phương án giữ D1.

Nhưng hai điểm tôi phải nói rõ, vì cả hai đều là chỗ sẽ đau về sau:

**(a) Ảnh trên Railway đúng cho ảnh món, nhưng sẽ vỡ ở M9.**

Container Railway có **filesystem tạm** — file ghi vào container **mất sạch mỗi lần deploy lại**. Muốn giữ phải gắn **Railway Volume**. Và một service có volume thì **chỉ chạy được 1 replica** — điều này cũng ràng buộc M12 (không scale ngang được).

Với ảnh món thì hoàn toàn ổn: khoảng 20 ảnh, 10–20 MB, đổi rất hiếm. Anh đúng.

Vấn đề là các module sau sinh ảnh **theo số giao dịch**, không phải theo số món:

| Nguồn ảnh | Module | Ước tính |
| --- | --- | --- |
| Ảnh món | M3 | ~20 ảnh, ~20 MB, gần như không đổi |
| Ảnh hóa đơn chi phí | M8 | vài ảnh/cửa hàng/tuần → ~100 MB/năm |
| Ảnh hao hụt | M7 | thỉnh thoảng → nhỏ |
| **Ảnh bằng chứng giao hàng (POD)** | **M9** | **23 điểm × ~50 đơn/ngày × 1 ảnh ≈ 1.150 ảnh/ngày** |

Nếu nén phía trình duyệt về ~80 KB thì POD tốn khoảng **92 MB/tháng, ~1,1 GB/năm** — cộng dồn. Volume Railway phải nâng dung lượng và trả tiền theo, còn ảnh phục vụ qua chính tiến trình Node (không có CDN) nên ăn CPU và băng thông của app.

**Đề xuất — vẫn làm all-on-Railway như anh chốt, nhưng ba việc rẻ tiền để không bị khóa:**
1. Viết `lib/storage.ts` như một **interface** với cài đặt `RailwayVolumeStorage`. Khi nào cần đổi sang S3/R2 chỉ là đổi cài đặt + biến môi trường, không viết lại nghiệp vụ. Chi phí thêm: gần như bằng 0.
2. **Nén phía trình duyệt** trước khi tải lên: resize cạnh dài về 1280px, JPEG chất lượng 70. Bắt buộc cho mọi ảnh.
3. **Chính sách lưu giữ**: POD giữ 90 ngày rồi xóa (đủ dài hơn thời hạn khiếu nại), ảnh chi phí giữ theo luật kế toán. Ở M9 ưu tiên **OTP giao hàng** hơn ảnh — vừa nhẹ vừa là bằng chứng tốt hơn.

Làm ba việc đó thì all-on-Railway chạy được lâu, và ngày nào cần đổi thì đổi trong một buổi.

**(b) SQLite làm nơi sao lưu cho Postgres — chỗ này tôi phải nói ngược lại.**

Sao lưu Postgres **bằng SQLite là không nên**. Hai hệ có kiểu dữ liệu, ràng buộc và cú pháp khác nhau; muốn đổ dữ liệu qua lại phải duy trì một lớp dịch schema vĩnh viễn — đúng cái "hai nguồn sự thật" mà M0 đang đi xóa. Chỉ cần thêm một cột ở Postgres mà quên sửa lớp dịch là bản sao lưu âm thầm mất dữ liệu, và chỉ phát hiện đúng lúc cần khôi phục.

Sao lưu Postgres đúng cách:
- **`pg_dump` định kỳ** ra file `.sql.gz`, đẩy sang nơi lưu ngoài, giữ 30 ngày.
- **Backup tự động của Railway** (gói trả phí có sẵn) + point-in-time recovery.
- Định kỳ **khôi phục thử** sang một database tạm để chứng minh bản sao lưu dùng được.

Vậy SQLite còn dùng vào đâu? Hai việc chính đáng:
1. **Nguồn cho lần chuyển đổi dữ liệu một lần** sang Postgres — nếu có dữ liệu thật (xem mục 6.6 bên dưới).
2. **Database cho test cục bộ.**

Nhưng việc (2) có cái giá: giữ SQLite cho test nghĩa là **mọi câu SQL phải chạy được trên cả hai phương ngữ, mãi mãi**. Đã chốt all-on-Railway rồi thì cái giá đó không đáng.

**Đề xuất: bỏ SQLite khỏi runtime hoàn toàn.** Test dùng Postgres thật — Docker cục bộ, hoặc một database test riêng trên Railway, hoặc `pglite` (Postgres biên dịch sang WASM, chạy trong tiến trình, đúng phương ngữ Postgres). Một phương ngữ duy nhất, ít lỗi hơn hẳn. Giữ file SQLite hiện có **chỉ đọc, làm nguồn chuyển đổi một lần**, xong thì lưu trữ lại.

> Nếu anh vẫn muốn giữ SQLite cho test thì được, nhưng phải viết vào quy ước: **mọi câu SQL phải kiểm trên cả hai**, và CI chạy test hai lần. Tôi khuyên không.

#### 3.3. Tạm bỏ OTP — hệ quả bắt buộc phải xử lý

Brandname eSMS chưa duyệt nên đợt này không có OTP. Việc này **giảm** phạm vi M1, nhưng làm lộ một lỗ hổng phải bịt:

> **Không được làm chức năng "quên mật khẩu" tự phục vụ khi chưa có kênh xác thực.** Không có SMS, không có email đã xác minh, thì bất kỳ ai nhập số điện thoại của người khác cũng đặt lại được mật khẩu của người đó. Đây là lỗ hổng chiếm tài khoản, không phải bất tiện nhỏ.

Cách làm ở đợt này:

| Đối tượng | Đăng ký | Quên mật khẩu |
| --- | --- | --- |
| **Nhân viên, chủ cửa hàng, kế toán, bếp** | Admin tạo tài khoản, hệ thống sinh mật khẩu tạm, admin giao trực tiếp (gặp mặt / Zalo). Bắt buộc đổi ở lần đăng nhập đầu. | **Admin đặt lại hộ.** An toàn, và với ~50 người thì hoàn toàn khả thi. |
| **Khách hàng** | Tự đăng ký bằng SĐT + mật khẩu, đánh dấu `phone_verified = false`. | **Chưa có tự phục vụ.** Khách vẫn đặt hàng được không cần tài khoản (guest checkout giữ nguyên). |

Vẫn **xây sẵn** bảng `otp_challenges`, `password_reset_tokens` và interface `lib/notifier.ts` với cài đặt `ConsoleNotifier`. Khi brandname được duyệt, bật eSMS chỉ là đổi biến môi trường + thêm một cài đặt — không phải làm lại M1.

Ghi rõ vào tài liệu bàn giao: **đây là hạn chế tạm thời có chủ đích**, cần gỡ ngay khi có eSMS.

#### Ghi chú thi công cho các quyết định đã chốt

**Q1 — chuyển PostgreSQL.** Các điểm phải đổi khi chuyển từ SQLite:

| SQLite (hiện tại) | PostgreSQL |
| --- | --- |
| `INSERT OR IGNORE` | `INSERT … ON CONFLICT DO NOTHING` |
| `MAX(0, x)` | `GREATEST(0, x)` |
| `PRAGMA table_info` / `PRAGMA foreign_keys` | bỏ; dùng `information_schema` |
| `d1.batch([...])` | một transaction `BEGIN … COMMIT` |
| `meta.changes` | `result.rowCount` |
| Trigger `RAISE(ABORT, …)` | `CHECK` constraint + hàm PL/pgSQL `RAISE EXCEPTION` |
| Boolean lưu `0`/`1` | kiểu `boolean` thật — rà mọi chỗ `.bind(true)` và so sánh `= 1` |
| `TEXT` chứa ISO datetime | giữ nguyên `TEXT` để không phải viết lại toàn bộ so sánh chuỗi thời gian *(khuyến nghị: đổi sang `timestamptz` là việc riêng, không làm cùng lúc)* |

Partial unique index (`CREATE UNIQUE INDEX … WHERE …`) mà code đang dùng nhiều cho `customers`, `operation_orders` — **PostgreSQL hỗ trợ đầy đủ**, chuyển thẳng được.

**Q2 + Q3 — xác thực SĐT + mật khẩu.**
- Băm mật khẩu bằng **PBKDF2-HMAC-SHA256 qua WebCrypto**, ≥ 210.000 vòng, salt 16 byte. Không dùng bcrypt/argon2 (không có trên Workers runtime; và nếu bỏ D1 theo Q9 thì có thể cân nhắc lại, nhưng PBKDF2 vẫn đủ an toàn).
- OTP qua eSMS **chỉ dùng 2 trường hợp**: xác thực khi đăng ký, và đặt lại mật khẩu. Không dùng để đăng nhập hằng ngày.
- **Lưu ý thực tế về eSMS:** tin nhắn OTP qua brandname phải **đăng ký template trước** với nhà mạng, không gửi được nội dung tùy ý. Cần chuẩn bị và chờ duyệt template — việc này mất vài ngày làm việc, nên bắt đầu **song song** với M0, đừng đợi đến M1.

**Q6 — hoãn hóa đơn điện tử.** Cần nói rõ: hoãn trong *phần mềm* không có nghĩa là hoãn *nghĩa vụ pháp lý*. Khi bắt đầu bán thật, vẫn phải xuất hóa đơn bằng cách đang làm hiện nay. M10 sẽ tạo sẵn bảng `einvoices` và interface `lib/einvoice.ts` để cắm nhà cung cấp vào sau mà không phải sửa lại nghiệp vụ.

### 3.2. Quy ước kỹ thuật áp dụng cho mọi module

| Chủ đề | Quy ước |
| --- | --- |
| **Tiền** | Luôn là `INTEGER` VND. Tỷ lệ luôn là basis point (`10_000` = 100%). Không dùng số thực. *(đã đúng, giữ nguyên)* |
| **Thời gian** | Lưu ISO-8601 UTC. Quy đổi `Asia/Ho_Chi_Minh` chỉ ở tầng hiển thị và khi gom nhóm theo ngày. *(đã có `hanoiDateKey`, giữ nguyên)* |
| **Migration** | Một trình chạy migration có thứ tự, chạy **một lần khi khởi động/deploy**, không chạy trong request. Bảng `runtime_schema_migrations` là nguồn sự thật. Không còn `CREATE TABLE IF NOT EXISTS` trong đường chạy request. |
| **Idempotency** | Mọi lệnh ghi nhận `Idempotency-Key`. Bảng `idempotency_keys(key, scope, request_hash, response_json, created_at)` với unique index. |
| **Đồng thời** | Giữ nguyên mô hình hiện tại: `UPDATE … WHERE id = ? AND updated_at = ?` rồi kiểm `meta.changes !== 1`. *(đã đúng, nhân rộng cho lệnh mới)* |
| **Nhật ký** | Mọi chuyển trạng thái ghi `operation_event_log`. Bổ sung `request_id` để truy vết. |
| **Lỗi** | Giữ `OperationsError(message, status, code)`. Mã lỗi `snake_case` ổn định, có tài liệu. |
| **Phân quyền** | Quyền và phạm vi **luôn đọc từ DB theo `user_id` trong phiên**. Không hardcode trong file. |
| **PII** | SĐT/email khách chỉ trả về cho vai trò có `customer-pii.read`. Mọi lần đọc PII hàng loạt ghi audit. |

---

## 4. Các module

Ký hiệu: 🔴 chặn đường (blocking) · 🟠 quan trọng · 🟡 nên có

---

### M0 — Nền móng dữ liệu & chuyển PostgreSQL 🔴

> **Mục tiêu:** một schema duy nhất, migration chạy một lần, không còn đường chạy "dữ liệu ảo", cấu hình được kiểm tra khi khởi động.

**Hiện trạng.** Schema tồn tại ở 2 nơi (V13). Bảng được tạo trong request. `executeMemory` nhân đôi nghiệp vụ (V7). `createSeedState()` (`lib/operations-store.ts:706`) nhúng ~180 dòng dữ liệu mẫu vào bundle production.

**Việc phải làm.**

1. **Trình chạy migration.**
   - Viết `db/migrate.ts`: đọc thư mục `drizzle/*.sql` theo thứ tự, so với `runtime_schema_migrations`, chạy phần còn thiếu trong transaction, ghi version.
   - Gọi từ `scripts/start-production.mjs` **trước khi** server nhận request; và từ một lệnh `npm run db:migrate` để chạy tay.
   - Gỡ `ensureD1Schema`, `ensureCatalogSchema`, `ensureProductionDataSchema`, `ensureGroupRoomsSchema`, `ensureSavedGroupsSchema` khỏi đường chạy request. Chuyển toàn bộ DDL của chúng thành file migration.
   - `db/schema.ts` (Drizzle) trở thành **nguồn sự thật duy nhất**; migration sinh bằng `drizzle-kit generate`.

2. **Xóa đường chạy bộ nhớ.**
   - Xóa `executeMemory()`, `memorySnapshot()`, `createSeedState()`, `createFinanceSeed()`, `getMemoryState()`, `assertMemoryFallbackAllowed()`, cờ `ALLOW_MEMORY_FALLBACK`.
   - Test chuyển sang SQLite `:memory:` thật qua `SQLITE_PATH=:memory:` (đã hỗ trợ, `db/runtime-database.ts:210`).
   - Ước tính giảm ~600 dòng và loại bỏ toàn bộ rủi ro lệch logic.

3. **Tách dữ liệu mẫu ra khỏi bundle.**
   - Chuyển seed thành script riêng `scripts/seed-demo.mjs`, chỉ chạy tay ở môi trường dev. Xóa lệnh `seed-demo` khỏi `OperationsCommand`.

4. **Kiểm tra cấu hình khi khởi động (fail fast).**
   - `lib/config.ts`: đọc và **validate toàn bộ biến môi trường một lần**, ném lỗi rõ ràng nếu thiếu. Thay cho việc mỗi lib tự đọc `process.env` rải rác (`lib/sepay.ts:50`, `lib/portal-session.ts:22`, `lib/operations-store.ts:894`…).
   - Bắt buộc ở production: `DATABASE_URL`/`SQLITE_PATH`, `PORTAL_SESSION_SECRET` ≥ 32 ký tự, `SEPAY_*`, `ORDER_DATA_MODE`.

5. **Chuyển PostgreSQL (Q1 — đã chốt, bắt buộc).**
   - Giữ nguyên interface `RuntimeDatabase` trong `db/runtime-database.ts`; chỉ thay driver, code nghiệp vụ không phải viết lại.
   - Driver: `postgres.js` hoặc `node-postgres` qua `drizzle-orm/postgres-js`. Connection pool giới hạn hợp lý cho gói Railway.
   - Bảng đối chiếu cú pháp SQLite → PostgreSQL nằm ở mục 3.1.
   - **Rủi ro lớn nhất của bước này:** `d1.batch()` đang được dùng khắp nơi như một transaction ngầm, và code kiểm `results[0].meta.changes !== 1` để phát hiện xung đột. Chuyển sang Postgres phải giữ **đúng** ngữ nghĩa đó — batch = một transaction, `changes` = `rowCount`. Sai chỗ này là mất cơ chế khóa lạc quan trên toàn hệ thống mà không có lỗi nào báo ra.
   - **Q9 đã chốt: bỏ toàn bộ Cloudflare.** Gỡ mọi `import { env } from "cloudflare:workers"` trong `lib/sepay.ts`, `lib/portal-session.ts`, `lib/operations-store.ts`, `lib/lalamove.ts`, `db/runtime-database.ts` — đọc biến môi trường thẳng từ `process.env` qua `lib/config.ts`. Xóa `scripts/cloudflare-workers-loader.mjs`, binding D1, và `.openai/hosting.json` nếu không còn dùng. Gỡ `wrangler`, `@cloudflare/vite-plugin`, `@cloudflare/workers-types` khỏi `package.json`.
   - **Khuyến nghị: bỏ luôn SQLite khỏi runtime.** Đã all-on-Railway thì giữ SQLite cho test nghĩa là mọi câu SQL phải chạy đúng trên hai phương ngữ, mãi mãi. Test nên dùng Postgres thật: Docker cục bộ, một database test riêng trên Railway, hoặc `pglite`. Giữ file SQLite hiện có **chỉ đọc, làm nguồn chuyển đổi một lần**. *(Nếu chủ hệ thống vẫn muốn giữ SQLite cho test thì phải ghi vào quy ước: CI chạy test trên cả hai phương ngữ.)*
   - **Lưu trữ file:** tạo `lib/storage.ts` với interface `Storage` và cài đặt `RailwayVolumeStorage` (ghi vào đường dẫn volume từ biến môi trường). Không dùng Cloudflare R2. Thiết kế interface để đổi sang S3 sau này chỉ là thêm một cài đặt.
   - Railway project token đã có sẵn trong `.env` (`RAILWAY_PROJECT_TOKEN`). Chuỗi kết nối Postgres cần tạo dịch vụ trên Railway rồi lấy `DATABASE_URL`.

6. **Hạ tầng cấu hình động (nền cho M14).** Tạo bảng `system_settings(key, value_json, scope_type, scope_value, updated_by, updated_at)` và hàm đọc có cache. Chưa cần màn hình quản trị — M14 làm. Nhưng `lib/config.ts` phải phân biệt rõ ngay từ đầu: **bí mật và hạ tầng** đọc từ biến môi trường; **thông số nghiệp vụ** đọc từ `system_settings`.

**Định nghĩa hoàn thành.**
- [ ] `npm run db:migrate` chạy từ PostgreSQL rỗng ra schema đầy đủ; chạy lại lần 2 không đổi gì.
- [ ] Chuyển đổi bản sao dữ liệu SQLite hiện có sang PostgreSQL, **không mất bản ghi nào** — có script đối chiếu số lượng bản ghi từng bảng trước/sau.
- [ ] Toàn bộ test hiện có xanh trên PostgreSQL, **không nới lỏng assertion nào**.
- [ ] Kiểm khóa lạc quan trên Postgres: hai request đồng thời chuyển cùng một đơn → đúng một request thành công, request kia nhận 409.
- [ ] `grep -r "CREATE TABLE IF NOT EXISTS" app/ lib/` không còn kết quả trong đường chạy request.
- [ ] Không còn tham chiếu `executeMemory` / `ALLOW_MEMORY_FALLBACK`.
- [ ] Khởi động với biến môi trường thiếu → log lỗi rõ ràng và thoát, không chạy nửa vời.

**Phụ thuộc:** không. **Ước lượng:** 4–5 người-tuần (đã gồm chuyển PostgreSQL).

---

### M1 — Danh tính & phân quyền thật 🔴

> **Mục tiêu:** mỗi người một tài khoản, phạm vi dữ liệu đọc từ DB, thu hồi được phiên, có nhật ký đăng nhập.

**Hiện trạng.** Một mã dùng chung mở mọi vai trò (V-mục 0.2.2). Phạm vi hardcode (V8). Không có bảng người dùng.

**Schema mới.**

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  phone_e164      TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  full_name       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | suspended | left
  password_hash   TEXT,                              -- PBKDF2-HMAC-SHA256, >=210k vòng
  password_salt   TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at   TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CONSTRAINT users_contact CHECK (phone_e164 <> '' OR email <> '')
);
CREATE UNIQUE INDEX users_phone_idx ON users (phone_e164) WHERE phone_e164 <> '' AND status <> 'left';
CREATE UNIQUE INDEX users_email_idx ON users (email) WHERE email <> '' AND status <> 'left';

-- Một người có thể giữ nhiều vai trò ở nhiều điểm (VD: chủ 3 cửa hàng)
CREATE TABLE user_role_assignments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL,          -- owner|kitchen|store-owner|store-staff|shipper|accountant
  site_id     TEXT REFERENCES operation_sites(id),  -- NULL = toàn hệ thống
  status      TEXT NOT NULL DEFAULT 'active',
  valid_from  TEXT NOT NULL,
  valid_to    TEXT,
  granted_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX user_role_unique_idx ON user_role_assignments (user_id, role, COALESCE(site_id,'*')) WHERE status = 'active';

-- Phiên lưu server-side để thu hồi được
CREATE TABLE user_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,
  active_role   TEXT NOT NULL,
  active_site_id TEXT,
  device_label  TEXT NOT NULL DEFAULT '',
  ip_hash       TEXT NOT NULL DEFAULT '',
  issued_at     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE otp_challenges (
  id          TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL,          -- register | reset-password   (KHÔNG dùng để đăng nhập)
  phone_e164  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  sent_at     TEXT,
  provider_message_id TEXT,           -- mã tin nhắn eSMS, để tra khi khách báo không nhận được
  created_at  TEXT NOT NULL
);

CREATE TABLE password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE auth_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  event      TEXT NOT NULL,           -- login.success | login.failed | logout | role.switch | password.reset
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
```

**Việc phải làm.**

1. **Đăng nhập bằng SĐT + mật khẩu (Q2 + Q3 — đã chốt).** Đây là cơ chế đăng nhập duy nhất dùng hằng ngày, cho cả nhân viên lẫn khách hàng.
   - Băm mật khẩu: PBKDF2-HMAC-SHA256 qua WebCrypto, ≥ 210.000 vòng, salt 16 byte ngẫu nhiên, lưu salt riêng. Không dùng bcrypt/argon2 (không có trên Workers runtime).
   - Yêu cầu mật khẩu tối thiểu 8 ký tự; chặn danh sách mật khẩu phổ biến.
   - Khóa tạm 15 phút sau 8 lần sai liên tiếp (đếm theo SĐT **và** theo IP, lấy điều kiện chặt hơn).
   - Nhân viên: admin mời → hệ thống sinh mật khẩu tạm gửi qua SMS → bắt buộc đổi ở lần đăng nhập đầu (`must_change_password`).
   - Khách hàng: tự đăng ký bằng SĐT, xác thực OTP một lần, rồi đặt mật khẩu.

2. **OTP — ⏸️ HOÃN ở đợt này (brandname eSMS chưa duyệt).**
   - **Vẫn xây sẵn** bảng `otp_challenges`, `password_reset_tokens` và interface `lib/notifier.ts` với cài đặt `ConsoleNotifier` (in mã ra log).
   - **Không** viết code gọi eSMS. Khi brandname được duyệt, thêm `EsmsNotifier` và đổi một biến môi trường — không phải làm lại M1.
   - Khi bật lại: 6 chữ số, hiệu lực 5 phút, tối đa 5 lần thử, lưu `code_hash` không lưu mã thô, rate limit 3 mã/SĐT/giờ và 10 mã/IP/giờ (mỗi SMS mất tiền thật).

3. **Quên mật khẩu — cách làm khi chưa có OTP.**
   > ⚠️ **Tuyệt đối không làm chức năng đặt lại mật khẩu tự phục vụ khi chưa có kênh xác thực.** Không SMS, không email đã xác minh, thì bất kỳ ai nhập số điện thoại của người khác cũng chiếm được tài khoản đó. Đây là lỗ hổng chiếm tài khoản, không phải bất tiện nhỏ.

   | Đối tượng | Đăng ký | Quên mật khẩu |
   | --- | --- | --- |
   | Nhân viên, chủ cửa hàng, kế toán, bếp | Admin tạo tài khoản → sinh mật khẩu tạm → giao trực tiếp → bắt buộc đổi lần đầu | **Admin đặt lại hộ.** Với ~50 người thì hoàn toàn khả thi |
   | Khách hàng | Tự đăng ký SĐT + mật khẩu, đánh dấu `phone_verified = false` | **Chưa có tự phục vụ.** Guest checkout vẫn dùng bình thường |

   Lệnh `user.reset-password` cho `owner` — sinh mật khẩu tạm mới, đặt `must_change_password = 1`, **thu hồi toàn bộ phiên đang mở** của tài khoản đó.
   Ghi vào tài liệu bàn giao: đây là hạn chế tạm thời có chủ đích, gỡ ngay khi có eSMS.

4. **Viết lại `lib/portal-session.ts`:**
   - Cookie chứa `sessionId` + chữ ký; **tra DB** mỗi request để lấy `user_id`, `role`, `site_id`, kiểm `revoked_at IS NULL`.
   - Giữ nguyên `HttpOnly`, `SameSite=Strict`, `Secure`. Bổ sung xoay token (rotation) khi đổi vai trò.
5. **Viết lại `lib/portal-access.ts`:**
   - Bỏ toàn bộ `siteIds`/`partnerIds`/`memberIds` hardcode.
   - Giữ **ma trận capability theo vai trò** (phần này đang tốt), nhưng **phạm vi (`scope`) đọc từ `user_role_assignments`**.
   - Ánh xạ 11 vai trò cũ → 7 vai trò mới để UI không phải sửa.
6. **Màn hình quản trị tài khoản** (bổ sung tối thiểu, giữ phong cách UI hiện có): admin mời người dùng, gán vai trò + cửa hàng, khóa tài khoản, đặt lại mật khẩu, xem phiên đang hoạt động, thu hồi phiên.
7. **Giữ đường thoát:** một tài khoản `owner` khởi tạo bằng biến môi trường lần đầu (`BOOTSTRAP_OWNER_PHONE`), chỉ chạy khi bảng `users` rỗng, bắt buộc đổi mật khẩu ở lần đăng nhập đầu.
8. **Rate limit đăng nhập chuyển sang DB** (xử lý luôn V5 cho đường auth).

**Định nghĩa hoàn thành.**
- [ ] Không còn `PORTAL_DEMO_ACCESS_CODE` trong code.
- [ ] Nhân viên cửa hàng A đăng nhập bằng SĐT + mật khẩu → API **chỉ** trả đơn của cửa hàng A (kiểm bằng test, không chỉ bằng UI).
- [ ] Admin đặt lại mật khẩu hộ một nhân viên → nhân viên đăng nhập bằng mật khẩu tạm, bị buộc đổi ngay, **mọi phiên cũ bị thu hồi**.
- [ ] **Không tồn tại** endpoint nào cho phép tự đặt lại mật khẩu mà không qua kênh xác thực (kiểm bằng test — đây là kiểm tra an ninh, không phải tính năng).
- [ ] Sai mật khẩu 8 lần → khóa 15 phút, đếm đúng qua nhiều instance.
- [ ] Admin thu hồi phiên → request tiếp theo của thiết bị đó trả `401` ngay.
- [ ] Nhân viên nghỉ việc → khóa tài khoản → mọi phiên hết hiệu lực.
- [ ] Test: đăng nhập vai trò `store-staff` rồi gửi `role: "owner"` trong body/URL → vẫn là `store-staff`.
- [ ] `auth_events` ghi đủ đăng nhập thành công/thất bại/đổi mật khẩu.
- [ ] Không có mã OTP, mật khẩu hay token nào bị ghi ra log ở production.

**Phụ thuộc:** M0. **Ước lượng:** 3–4 người-tuần.

---

### M2 — Master data mạng lưới: 23 cửa hàng, bếp tổng, nhân sự 🔴

> **Mục tiêu:** dữ liệu 23 cửa hàng thật nằm trong DB, quản trị được từ giao diện, và **frontend đọc từ API thay vì file TSX**.

**Hiện trạng.** 4 điểm mẫu trong seed; 36 điểm hardcode ở `app/order/page.tsx:766`; ánh xạ 3 site khi đặt hàng (`:1934`); không có lệnh tạo/sửa cửa hàng hay nhân viên.

**Schema — mở rộng `operation_sites`.**

```sql
ALTER TABLE operation_sites ADD COLUMN owner_user_id      TEXT REFERENCES users(id);
ALTER TABLE operation_sites ADD COLUMN opening_hours_json TEXT NOT NULL DEFAULT '{}';  -- {"mon":[["06:30","22:00"]], ...}
ALTER TABLE operation_sites ADD COLUMN service_radius_m   INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE operation_sites ADD COLUMN fulfillment_json   TEXT NOT NULL DEFAULT '["delivery","pickup"]';
ALTER TABLE operation_sites ADD COLUMN accepts_orders     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE operation_sites ADD COLUMN timezone           TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
ALTER TABLE operation_sites ADD COLUMN opened_at          TEXT;
ALTER TABLE operation_sites ADD COLUMN closed_at          TEXT;

CREATE TABLE site_closures (            -- nghỉ lễ, sửa chữa, hết hàng đột xuất
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES operation_sites(id),
  reason TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE work_shifts (              -- ca làm việc, cần cho M8 đối soát quỹ
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES operation_sites(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL, closed_at TEXT,
  opening_cash INTEGER NOT NULL DEFAULT 0,
  counted_cash INTEGER, expected_cash INTEGER, variance INTEGER,
  note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX work_shifts_site_idx ON work_shifts (site_id, opened_at);
```

Đồng thời liên kết `operation_staff.user_id → users.id` (hiện `operation_staff` là bảng độc lập, không nối với ai).

**Lệnh API mới.**

| Lệnh | Vai trò | Ghi chú |
| --- | --- | --- |
| `site.create` | `owner` | Tạo cửa hàng, sinh mã, gán chủ |
| `site.update` | `owner`, `store-owner` (điểm của mình) | Địa chỉ, giờ mở, tọa độ, bán kính |
| `site.set-status` | `owner`, `store-owner` | Mở/tạm đóng/đóng vĩnh viễn |
| `staff.invite` | `owner`, `store-owner` | Tạo `users` + `user_role_assignments` |
| `staff.update` / `staff.deactivate` | `owner`, `store-owner` | |
| `shift.open` / `shift.close` | `store-staff`, `store-owner` | Mở/chốt ca, đếm tiền |
| `partner.create` / `partner.update` | `owner` | Đối tác phân phối |

**API công khai mới.** `GET /api/sites` — trả danh sách điểm bán đang mở, có tọa độ, giờ mở, dịch vụ, khoảng cách (nếu client gửi vị trí). Đây là API để **thay thế mảng `storePoints` hardcode**.

**Sửa frontend (chỉ đổi nguồn dữ liệu, giữ nguyên giao diện).**
- `app/order/page.tsx`: xóa mảng `storePoints` (36 phần tử, dòng 799–921) và `locations` (dòng 766–797); thay bằng `fetch("/api/sites")` + state.
- Xóa đoạn ánh xạ 3 site (`:1934–1939`); dùng thẳng `site.id` từ API.
- `app/order/HanoiStoreMap.tsx` nhận điểm bán qua props thay vì import hằng số.

**Dữ liệu khởi tạo.** Một script `scripts/import-sites.mjs` đọc CSV 23 cửa hàng thật (tên, mã, loại, địa chỉ, tọa độ, chủ, SĐT, giờ mở) và nạp vào DB. Anh cần cung cấp file này — **đây là đầu vào nghiệp vụ, không phải việc lập trình.**

**Định nghĩa hoàn thành.**
- [ ] `SELECT COUNT(*) FROM operation_sites WHERE status='open'` = 23 (+1 bếp tổng).
- [ ] `grep "storePoints" app/order/page.tsx` không còn mảng hằng số.
- [ ] Đặt đơn ở cửa hàng thứ 17 → đơn có đúng `site_id` của điểm đó.
- [ ] Tạo cửa hàng mới từ giao diện admin → xuất hiện ngay trên `/order` mà không cần deploy.
- [ ] Cửa hàng ngoài giờ mở cửa → API từ chối tạo đơn với mã lỗi rõ ràng.

**Phụ thuộc:** M0, M1. **Ước lượng:** 2–3 người-tuần.

---

### M3 — Thực đơn, giá theo điểm bán và nội dung sản phẩm 🟠

> **Mục tiêu:** admin sửa được món và giá không cần deploy; giá khác nhau theo loại điểm bán; UI khách đọc thực đơn từ API.

**Hiện trạng.** Backend đọc catalog từ DB (tốt), nhưng UI hardcode 12 món kèm mô tả, dinh dưỡng, dị ứng, rating (`app/order/page.tsx:325–678`). Không có lệnh sửa giá. Không có giá theo điểm — dù dữ liệu mẫu đã lộ ra nhu cầu này: cùng món `DC-CHEBUOI` giá 15.000đ ở cửa hàng chính thống nhưng 23.000đ ở điểm đối tác (`lib/operations-store.ts:858`).

**Schema.**

```sql
-- Bổ sung nội dung marketing vào catalog_products
ALTER TABLE catalog_products ADD COLUMN description   TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN note          TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN ingredients   TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN allergens     TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN origin        TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN nutrition_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE catalog_products ADD COLUMN tags_json     TEXT NOT NULL DEFAULT '[]';
ALTER TABLE catalog_products ADD COLUMN image_url     TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN serving       TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN prep_minutes  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN sweetness_json TEXT NOT NULL DEFAULT '[]';

-- Giá theo điểm bán / theo loại điểm, có hiệu lực thời gian
CREATE TABLE catalog_price_overrides (
  id           TEXT PRIMARY KEY,
  product_sku  TEXT NOT NULL REFERENCES catalog_products(sku),
  scope_type   TEXT NOT NULL,          -- site | site_kind | channel
  scope_value  TEXT NOT NULL,          -- site-xxx | partner-counter | group-order
  price        INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  created_by   TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX price_override_lookup_idx ON catalog_price_overrides (product_sku, scope_type, scope_value, effective_from);

-- Lịch sử đổi giá (bắt buộc để đối soát)
CREATE TABLE catalog_price_history (
  id TEXT PRIMARY KEY, product_sku TEXT NOT NULL, scope_type TEXT NOT NULL, scope_value TEXT NOT NULL,
  old_price INTEGER, new_price INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL, changed_at TEXT NOT NULL
);

-- Giá giao từ bếp tổng xuống điểm bán (dùng ở M7 & M10)
CREATE TABLE catalog_transfer_prices (
  id TEXT PRIMARY KEY, product_sku TEXT NOT NULL, site_kind TEXT NOT NULL,
  transfer_price INTEGER NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
```

**Việc phải làm.**
1. Lệnh `product.create`, `product.update`, `product.archive`, `product.option.upsert`, `price.set` (ghi `catalog_price_history` mọi lần đổi).
2. `resolvePrice(sku, siteId, channel, at)` — hàm giải giá duy nhất: override theo `site` → override theo `site_kind` → `base_price`. **Mọi nơi tính tiền phải gọi hàm này**, kể cả `orderItemsFrom()` (`lib/operations-store.ts:2012`) hiện đang dùng thẳng `product.price`.
3. `GET /api/catalog` bổ sung toàn bộ trường nội dung + giá đã giải theo `siteId`.
4. `app/order/page.tsx`: xóa mảng `products` (dòng 325–678), thay bằng dữ liệu từ `/api/catalog?siteId=…`. Giữ nguyên component hiển thị.
5. Upload ảnh món lên **Railway Volume** qua `lib/storage.ts` (Q5 đã đổi: bỏ Cloudflare R2). Bắt buộc **nén phía trình duyệt**: resize cạnh dài 1280px, JPEG chất lượng 70. Lưu đường dẫn tương đối, phục vụ qua route có kiểm quyền.
6. Màn hình quản trị thực đơn cho `owner` (thêm mới, phong cách UI hiện có).

**Định nghĩa hoàn thành.**
- [ ] Admin đổi giá chè bưởi từ 28.000 → 29.000 trên giao diện → khách thấy giá mới sau lần tải tiếp theo, không cần deploy.
- [ ] Cùng một món hiển thị và tính đúng hai mức giá ở cửa hàng chính thống vs điểm đối tác.
- [ ] Đơn cũ giữ nguyên giá tại thời điểm mua (đã đúng nhờ `base_unit_price` trên từng dòng món — kiểm lại bằng test).
- [ ] `grep "const products: Product\[\]" app/order/page.tsx` không còn kết quả.

**Phụ thuộc:** M0, M2. **Ước lượng:** 2–3 người-tuần.

---

### M4 — Đơn hàng: idempotency, vòng đời đầy đủ, màn hình bếp 🟠

> **Mục tiêu:** không tạo đơn trùng; xử lý được đầy đủ tình huống thực tế (sửa đơn, hủy một phần, khách không nhận); nhân viên bếp có màn hình làm việc đúng nghiệp vụ.

**Hiện trạng.** Luồng chính đã tốt. Thiếu: idempotency thật (V3), sửa đơn, hủy một phần, ăn tại chỗ, đơn đặt trước theo khung giờ (UI có `StorePreorderMode: "dine-in" | "pickup"` nhưng backend chỉ có `delivery | pickup`).

**Schema.**

```sql
CREATE TABLE idempotency_keys (
  key           TEXT NOT NULL,
  scope         TEXT NOT NULL,        -- order.create | payment.refund | ...
  request_hash  TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- Sửa đơn có vết
CREATE TABLE order_amendments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES operation_orders(id),
  amendment_type TEXT NOT NULL,       -- add_item | remove_item | change_qty | change_address | change_slot
  before_json TEXT NOT NULL, after_json TEXT NOT NULL,
  amount_delta INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL
);

ALTER TABLE operation_orders ADD COLUMN fulfillment_type_ext TEXT NOT NULL DEFAULT 'delivery'; -- delivery|pickup|dine-in
ALTER TABLE operation_orders ADD COLUMN scheduled_for   TEXT;      -- đặt trước theo khung giờ
ALTER TABLE operation_orders ADD COLUMN table_label     TEXT NOT NULL DEFAULT '';  -- số bàn khi dine-in
ALTER TABLE operation_orders ADD COLUMN group_room_code TEXT;      -- liên kết M5
ALTER TABLE operation_orders ADD COLUMN shift_id        TEXT REFERENCES work_shifts(id);

-- Bắt buộc: chống đơn trùng
CREATE UNIQUE INDEX operation_orders_client_ref_unique_idx
  ON operation_orders (source_environment, client_reference)
  WHERE client_reference IS NOT NULL;
```

**Việc phải làm.**
1. **Idempotency:** middleware đọc header `Idempotency-Key`; nếu đã có bản ghi cùng `request_hash` → trả lại response cũ; khác hash → `409 idempotency_key_conflict`. Áp cho `order.create`, `payment.refund`, `transfer.receive`.
2. **Frontend gửi khóa:** `app/order/page.tsx:1949` sinh UUID một lần khi mở màn thanh toán, gửi kèm mọi lần thử; không sinh lại khi retry.
3. **Sửa đơn:** lệnh `order.amend` (thêm/bớt món, đổi địa chỉ) — tính lại tổng tiền, chênh lệch ghi `order_amendments`, sinh yêu cầu thu thêm hoặc hoàn bớt.
4. **Hủy một phần / khách không nhận:** trạng thái `delivery_failed`, quy trình xử lý món (hủy, bán lại, ghi hao hụt) nối vào M7.
5. **Ăn tại chỗ (`dine-in`):** không tính phí ship, không cần địa chỉ, có số bàn.
6. **Đặt trước theo khung giờ:** `scheduled_for` + kiểm tra công suất `capacity_per_hour` của điểm; từ chối khi khung giờ đã đầy.
7. **Màn hình bếp (KDS):** endpoint `GET /api/kitchen/queue?siteId=` trả hàng đợi món theo `promised_at`, cùng lệnh `order.item.start` / `order.item.done` để theo dõi từng dòng món (hiện chỉ có trạng thái ở cấp đơn).
8. **Sửa V12:** hoặc cài đặt `order.dispatch-external` trong `executeD1`, hoặc gỡ khỏi `OperationsCommand` và khỏi capability của các vai trò.

**Định nghĩa hoàn thành.**
- [ ] Gửi cùng `Idempotency-Key` 5 lần song song → **đúng 1 đơn**, 5 response giống nhau.
- [ ] Bấm "Đặt đơn" hai lần liên tiếp trên điện thoại thật → 1 đơn.
- [ ] Sửa đơn tăng 20.000đ → sinh yêu cầu thu thêm, sổ cái khớp.
- [ ] Đơn `dine-in` không bị tính phí ship và không yêu cầu địa chỉ.
- [ ] Đặt trước vượt công suất giờ đó → bị từ chối kèm gợi ý khung giờ khác.

**Phụ thuộc:** M0, M2, M3. **Ước lượng:** 2–3 người-tuần.

---

### M5 — Đơn nhóm thật: chia món, chia tiền, hoa hồng chủ phòng 🟠

> **Mục tiêu:** phòng nhóm sinh ra **một đơn hàng thật có danh sách người**, mỗi người trả phần mình được, và chủ phòng nhận hoa hồng — đúng như mô hình anh mô tả.

**Hiện trạng.** V9 — phòng chỉ đổ món vào giỏ chủ phòng. Hết hạn 5 phút. Không có topping/ghi chú cho món của khách. Không có hoa hồng chủ phòng.

**Schema.**

```sql
ALTER TABLE group_rooms ADD COLUMN site_id        TEXT REFERENCES operation_sites(id);
ALTER TABLE group_rooms ADD COLUMN host_user_id   TEXT REFERENCES users(id);
ALTER TABLE group_rooms ADD COLUMN order_id       TEXT REFERENCES operation_orders(id);
ALTER TABLE group_rooms ADD COLUMN split_mode     TEXT NOT NULL DEFAULT 'host_pays'; -- host_pays | each_pays
ALTER TABLE group_rooms ADD COLUMN closes_at      TEXT NOT NULL;    -- thay expires_at 5 phút
ALTER TABLE group_rooms ADD COLUMN host_commission_bps INTEGER NOT NULL DEFAULT 0;

ALTER TABLE group_room_items ADD COLUMN option_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE group_room_items ADD COLUMN sweetness TEXT NOT NULL DEFAULT '';
ALTER TABLE group_room_items ADD COLUMN note      TEXT NOT NULL DEFAULT '';
ALTER TABLE group_room_items ADD COLUMN guest_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE group_room_items ADD COLUMN order_item_id TEXT;         -- ánh xạ sang dòng đơn thật
ALTER TABLE group_room_items ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE group_room_items ADD COLUMN payment_attempt_id TEXT;

-- Nguồn giới thiệu dùng chung cho affiliate và chủ phòng (xem M6)
CREATE TABLE order_referrals (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL REFERENCES operation_orders(id),
  referrer_type  TEXT NOT NULL,        -- affiliate | group_host | store_staff
  referrer_id    TEXT NOT NULL,
  referral_code  TEXT,
  commission_bps INTEGER NOT NULL,
  commission_amount INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending|earned|paid|void
  created_at     TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX order_referrals_unique_idx ON order_referrals (order_id, referrer_type);
```

**Việc phải làm.**
1. **Chốt phòng → tạo đơn thật.** Lệnh `group.finalize` chạy trong một transaction:
   - Sinh `operation_orders` với `channel = 'group-order'`, `group_room_code`.
   - Mỗi `group_room_items` → một `operation_order_items` (giá giải lại từ catalog server-side, **không tin giá lưu trong phòng**), `note` chứa tên người đặt để in tem.
   - Giữ tồn theo tổng số lượng.
   - Ghi `order_referrals` cho chủ phòng với `referrer_type='group_host'`.
2. **Chia tiền (`each_pays`):** mỗi thành viên có một `payment_attempts` riêng (SePay hỗ trợ nhiều mã cho một đơn — cần bỏ ràng buộc "một attempt/đơn" nếu có). Đơn chỉ vào bếp khi **tổng đã thu ≥ tổng đơn**. Ai chưa trả thì hiển thị công khai trong phòng.
3. **Hạn phòng linh hoạt:** chủ phòng chọn `closes_at` (15 phút → 24 giờ), thay cho 5 phút cứng. Job nền tự chốt hoặc hủy phòng quá hạn.
4. **Hoa hồng chủ phòng:** tỷ lệ cấu hình theo chính sách (`finance_price_policies.group_host_bps`), mặc định thấp hơn affiliate (VD 3%). Ghi vào sổ cái như hoa hồng affiliate, chi trả cùng cơ chế M6.
5. **Chống trục lợi:** chủ phòng **không** nhận hoa hồng phần món của chính mình; phòng có < 3 người không tính hoa hồng; giới hạn số phòng/tháng.
6. **Tem tên:** endpoint trả dữ liệu in tem theo từng món (tên người, món, tùy chọn) cho bếp.

**Định nghĩa hoàn thành.**
- [ ] Chốt phòng 8 người → **1 đơn**, 8 dòng món có tên người, tồn giữ đúng 8 phần.
- [ ] Chế độ "mỗi người tự trả": 8 mã QR riêng; trả đủ 8 mới vào bếp.
- [ ] Chủ phòng thấy hoa hồng trong tài khoản sau khi đơn giao xong.
- [ ] Chủ phòng đặt một mình → không có hoa hồng.
- [ ] Phòng hết hạn không có ai đặt món → tự hủy, không giữ tồn.

**Phụ thuộc:** M1, M3, M4, M8. **Ước lượng:** 2–3 người-tuần.

---

### M6 — Affiliate: tài khoản, quy kết, chống gian lận, chi trả 🟠

> **Mục tiêu:** cộng tác viên có tài khoản thật, xem được hoa hồng, nhận được tiền; hệ thống chống được các kiểu trục lợi cơ bản.

**Hiện trạng.** Khung sườn khá tốt: đăng ký (`/api/customer-requests`) → duyệt (`affiliate.approve`) → sinh mã → quy kết khi đặt đơn (`affiliateForDatabase`, `lib/operations-store.ts:1918`) → phân bổ → sổ cái → đối soát (`finance.settle`). Đã chặn tự giới thiệu theo SĐT/email.

Thiếu: đăng nhập thật (token nằm trong `localStorage`, `app/order/page.tsx:1410`), quản lý nhiều mã, cửa sổ quy kết, chống gian lận, xuất file chi trả.

**Schema.**

```sql
ALTER TABLE affiliate_members ADD COLUMN user_id      TEXT REFERENCES users(id);
ALTER TABLE affiliate_members ADD COLUMN tier         TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE affiliate_members ADD COLUMN tax_code     TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_members ADD COLUMN id_number_hash TEXT NOT NULL DEFAULT '';  -- CCCD băm, để chống trùng người
ALTER TABLE affiliate_members ADD COLUMN suspended_reason TEXT NOT NULL DEFAULT '';

CREATE TABLE affiliate_clicks (         -- cửa sổ quy kết
  id TEXT PRIMARY KEY, code TEXT NOT NULL, visitor_hash TEXT NOT NULL,
  landed_at TEXT NOT NULL, expires_at TEXT NOT NULL, converted_order_id TEXT
);
CREATE INDEX affiliate_clicks_visitor_idx ON affiliate_clicks (visitor_hash, expires_at);

CREATE TABLE payout_batches (
  id TEXT PRIMARY KEY, batch_code TEXT NOT NULL UNIQUE,
  counterparty_type TEXT NOT NULL,      -- affiliate | group_host | partner | store
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  total_amount INTEGER NOT NULL, entry_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|approved|exported|paid
  export_file_url TEXT NOT NULL DEFAULT '',
  approved_by TEXT, approved_at TEXT, paid_at TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE payout_items (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES payout_batches(id),
  referral_id TEXT REFERENCES order_referrals(id),
  recipient_id TEXT NOT NULL, amount INTEGER NOT NULL,
  bank_code TEXT NOT NULL, account_number TEXT NOT NULL, account_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', provider_reference TEXT NOT NULL DEFAULT ''
);
```

**Việc phải làm.**
1. **Đăng nhập affiliate** qua SĐT + OTP (M1), thay token `localStorage`. Trang affiliate ở `/order` đọc dữ liệu qua phiên thay vì query string.
2. **Chuyển quy kết sang `order_referrals`** (bảng dùng chung với chủ phòng nhóm ở M5). Giữ `finance_order_allocations.affiliate_code` để không phá báo cáo cũ, nhưng nguồn sự thật là `order_referrals`.
3. **Cửa sổ quy kết:** link `?ref=CODE` ghi `affiliate_clicks` (băm IP+UA, không lưu PII), hiệu lực 7 ngày; đơn trong cửa sổ được quy kết kể cả khi khách không nhập mã.
4. **Chống gian lận:**
   - Không quy kết nếu SĐT/email/CCCD khách trùng affiliate *(đã có phần SĐT/email)*.
   - Giới hạn số đơn/khách/tháng cho một mã.
   - Đơn bị hủy hoặc hoàn tiền → hoa hồng chuyển `void` *(hiện đã void allocation, cần void cả referral)*.
   - Hoa hồng chỉ chuyển `earned` sau khi đơn `delivered` **và** qua thời hạn khiếu nại (VD 24 giờ).
   - Cảnh báo khi một mã có tỷ lệ hủy bất thường.
5. **Chi trả theo lô:** lệnh `payout.create-batch` gom hoa hồng `earned` theo kỳ → `payout_batches` + `payout_items`; xuất file CSV/Excel định dạng chuyển khoản hàng loạt của ngân hàng; sau khi chuyển tiền, `payout.mark-paid` với mã giao dịch → cập nhật sổ cái.
6. **Thuế TNCN:** hoa hồng > ngưỡng phải khấu trừ 10% — thêm trường `tax_withheld` vào `payout_items` và báo cáo cuối năm.

**Định nghĩa hoàn thành.**
- [ ] Affiliate đăng nhập bằng SĐT trên máy mới → thấy đủ lịch sử hoa hồng.
- [ ] Khách bấm link `?ref=` hôm nay, đặt hàng sau 3 ngày → vẫn được quy kết.
- [ ] Đơn hoàn tiền → hoa hồng biến mất khỏi số "sẵn sàng chi".
- [ ] Chạy chi trả tháng → ra file chuyển khoản đúng định dạng ngân hàng, tổng khớp sổ cái.
- [ ] Affiliate tự đặt bằng mã của mình → bị từ chối.

**Phụ thuộc:** M1, M4, M10. **Ước lượng:** 2–3 người-tuần.

---

### M7 — Bếp tổng: sản xuất, điều chuyển, kho 🔴 **(nghiệp vụ lõi, hiện chưa có gì)**

> **Mục tiêu:** phần mềm phản ánh đúng việc bếp tổng sản xuất và phân phối cho 23 cửa hàng, và **giá vốn trong báo cáo là chi phí thật**.

**Hiện trạng.** Không tồn tại. `catalog_site_stock` có cơ chế trừ tồn khi bán nhưng **không có cách nào nạp hàng vào**. `operation_inventory` (nguyên liệu) chỉ chỉnh tay bằng `inventory.adjust`.

**Schema mới — đây là phần lớn nhất của kế hoạch.**

```sql
-- ========== NGUYÊN LIỆU & MUA HÀNG ==========
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '', tax_code TEXT NOT NULL DEFAULT '',
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY, po_code TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  site_id TEXT NOT NULL REFERENCES operation_sites(id),   -- thường là bếp tổng
  status TEXT NOT NULL DEFAULT 'draft',  -- draft|ordered|partially_received|received|cancelled
  ordered_at TEXT, expected_at TEXT, received_at TEXT,
  subtotal INTEGER NOT NULL DEFAULT 0, vat_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  invoice_number TEXT NOT NULL DEFAULT '', invoice_url TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  material_sku TEXT NOT NULL, material_name TEXT NOT NULL, unit TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL, quantity_received INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL, line_total INTEGER NOT NULL
);

-- ========== ĐỊNH MỨC & SẢN XUẤT ==========
CREATE TABLE product_recipes (           -- BOM: 1 phần thành phẩm cần gì
  id TEXT PRIMARY KEY, product_sku TEXT NOT NULL REFERENCES catalog_products(sku),
  material_sku TEXT NOT NULL, quantity_per_unit INTEGER NOT NULL,  -- nhân 1000 để tránh số thực
  unit TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL, effective_to TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX product_recipes_idx ON product_recipes (product_sku, effective_from);

CREATE TABLE production_batches (
  id TEXT PRIMARY KEY, batch_code TEXT NOT NULL UNIQUE,     -- VD: LOT-260816-TPHN-01
  site_id TEXT NOT NULL REFERENCES operation_sites(id),      -- bếp tổng
  product_sku TEXT NOT NULL REFERENCES catalog_products(sku),
  planned_quantity INTEGER NOT NULL,
  produced_quantity INTEGER NOT NULL DEFAULT 0,
  rejected_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned|in_progress|completed|cancelled
  material_cost INTEGER NOT NULL DEFAULT 0,   -- giá vốn nguyên liệu thật của mẻ
  labor_cost INTEGER NOT NULL DEFAULT 0,
  overhead_cost INTEGER NOT NULL DEFAULT 0,
  unit_cost INTEGER NOT NULL DEFAULT 0,       -- = (material+labor+overhead)/produced_quantity
  produced_at TEXT, expires_at TEXT,          -- hạn dùng, bắt buộc cho chè nấu trong ngày
  quality_check_by TEXT, quality_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX production_batches_idx ON production_batches (product_sku, produced_at);
CREATE INDEX production_batches_expiry_idx ON production_batches (expires_at, status);

CREATE TABLE production_material_usage (   -- nguyên liệu thực tế đã dùng cho mẻ
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES production_batches(id),
  material_sku TEXT NOT NULL, quantity_used INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL, total_cost INTEGER NOT NULL, created_at TEXT NOT NULL
);

-- ========== ĐIỀU CHUYỂN BẾP → CỬA HÀNG ==========
CREATE TABLE transfer_orders (
  id TEXT PRIMARY KEY, transfer_code TEXT NOT NULL UNIQUE,   -- VD: DC-260816-MD-01
  from_site_id TEXT NOT NULL REFERENCES operation_sites(id),
  to_site_id   TEXT NOT NULL REFERENCES operation_sites(id),
  status TEXT NOT NULL DEFAULT 'requested',
      -- requested → approved → packed → in_transit → received | partially_received | rejected | cancelled
  requested_by TEXT NOT NULL, approved_by TEXT, packed_by TEXT, received_by TEXT,
  requested_at TEXT NOT NULL, approved_at TEXT, packed_at TEXT,
  shipped_at TEXT, received_at TEXT,
  transfer_value INTEGER NOT NULL DEFAULT 0,   -- tổng theo giá giao (công nợ nội bộ)
  cost_value     INTEGER NOT NULL DEFAULT 0,   -- tổng theo giá vốn thật (để tính lãi bếp)
  vehicle TEXT NOT NULL DEFAULT '', driver_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX transfer_orders_to_site_idx ON transfer_orders (to_site_id, status, requested_at);

CREATE TABLE transfer_order_items (
  id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfer_orders(id),
  product_sku TEXT NOT NULL, batch_id TEXT REFERENCES production_batches(id),
  quantity_requested INTEGER NOT NULL,
  quantity_shipped   INTEGER NOT NULL DEFAULT 0,
  quantity_received  INTEGER NOT NULL DEFAULT 0,
  quantity_rejected  INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT NOT NULL DEFAULT '',
  transfer_price INTEGER NOT NULL,      -- giá giao tại thời điểm xuất
  unit_cost      INTEGER NOT NULL,      -- giá vốn thật tại thời điểm xuất
  expires_at TEXT
);

-- ========== KIỂM KÊ & HAO HỤT ==========
CREATE TABLE stock_counts (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES operation_sites(id),
  count_type TEXT NOT NULL,             -- shift_close | daily | monthly | spot
  status TEXT NOT NULL DEFAULT 'open',
  counted_by TEXT NOT NULL, approved_by TEXT,
  started_at TEXT NOT NULL, completed_at TEXT,
  variance_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stock_count_items (
  id TEXT PRIMARY KEY, count_id TEXT NOT NULL REFERENCES stock_counts(id),
  product_sku TEXT NOT NULL, system_quantity INTEGER NOT NULL,
  counted_quantity INTEGER NOT NULL, variance INTEGER NOT NULL,
  variance_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE waste_records (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES operation_sites(id),
  product_sku TEXT, material_sku TEXT, batch_id TEXT,
  quantity INTEGER NOT NULL, unit_cost INTEGER NOT NULL, total_cost INTEGER NOT NULL,
  reason TEXT NOT NULL,                 -- expired | damaged | quality | customer_return | theft
  photo_url TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL, approved_by TEXT, created_at TEXT NOT NULL
);
```

**Luồng nghiệp vụ cần cài đặt.**

```
[Mua nguyên liệu]  purchase_orders → nhận hàng → operation_inventory (+)  → công nợ NCC
        ↓
[Sản xuất]  production_batches: trừ operation_inventory theo product_recipes
                              → cộng catalog_site_stock của BẾP TỔNG (+)
                              → tính unit_cost thật của mẻ
        ↓
[Điều chuyển]  transfer_orders: bếp xuất → trừ tồn bếp, giữ hàng đang đi
               cửa hàng nhận → cộng catalog_site_stock cửa hàng (+)
                             → ghi CÔNG NỢ NỘI BỘ cửa hàng ↔ bếp (theo transfer_price)
                             → ghi giá vốn thật vào lô hàng tại điểm (theo unit_cost)
        ↓
[Bán hàng]  order.create giữ tồn → delivered trừ tồn  *(đã có)*
            + ghi COGS thật theo FEFO thay vì 20% giá bán
        ↓
[Kiểm kê]  stock_counts đối chiếu → chênh lệch → waste_records → ghi chi phí
```

**Việc phải làm.**
1. Lệnh: `supplier.upsert`, `purchase.create/receive`, `recipe.upsert`, `production.plan/start/complete`, `transfer.request/approve/pack/ship/receive/reject`, `stockcount.open/submit/approve`, `waste.record`.
2. **FEFO (hết hạn trước, xuất trước):** khi xuất hàng và khi trừ tồn lúc bán, chọn lô có `expires_at` gần nhất. Cần bảng `site_stock_lots(site_id, product_sku, batch_id, quantity, unit_cost, expires_at)` để theo dõi tồn theo lô.
3. **Giá vốn thật thay cho 20%:** sửa `calculateAllocation()` (`lib/operations-store.ts:603`) — `workshopCost` lấy từ tổng `unit_cost × quantity` của các lô thực sự dùng cho đơn, không phải `grossRevenue × 20%`. Đây là thay đổi làm cho toàn bộ M10 có ý nghĩa.
4. **Cảnh báo tự động:** tồn dưới định mức → gợi ý phiếu điều chuyển; lô sắp hết hạn (< 24 giờ) → cảnh báo; chênh lệch kiểm kê vượt ngưỡng → cảnh báo cho `owner`.
5. **Gợi ý nhập hàng:** tính tốc độ bán 7 ngày × số ngày dự trữ − tồn hiện có → số lượng đề xuất.
6. **Giao diện:** màn hình bếp tổng (kế hoạch sản xuất, mẻ đang làm, phiếu xuất) và màn hình cửa hàng (phiếu chờ nhận, xác nhận nhận hàng, báo thiếu/hỏng). Giữ phong cách UI portal hiện có.

**Định nghĩa hoàn thành.**
- [ ] Bếp tạo mẻ 200 phần → nguyên liệu trừ đúng theo định mức, `unit_cost` tính ra số hợp lý.
- [ ] Xuất 30 phần cho cửa hàng Mỹ Đình → tồn bếp giảm 30, cửa hàng xác nhận → tồn Mỹ Đình tăng 30, công nợ nội bộ tăng đúng giá giao.
- [ ] Cửa hàng nhận thiếu 2 phần → chỉ cộng 28, chênh lệch có phiếu xử lý.
- [ ] Bán 1 phần → COGS ghi nhận bằng `unit_cost` **thật của lô đó**, không phải 20% giá bán.
- [ ] Lô hết hạn không được bán ra; ghi `waste_records` và trừ vào lợi nhuận điểm.
- [ ] Kiểm kê cuối ca lệch 3 phần → sinh cảnh báo và phiếu chờ duyệt.

**Phụ thuộc:** M0, M2, M3. **Ước lượng:** 5–7 người-tuần. **Đây là module lớn nhất.**

---

### M14 — Bảng cấu hình hệ thống 🟠 *(module mới, sinh ra từ quyết định Phần 6)*

> **Mục tiêu:** mọi thông số nghiệp vụ do admin chỉnh trong phần mềm, không ai phải sửa code và deploy lại để đổi một con số.

**Vì sao có module này.** Chủ hệ thống chốt: không cung cấp file thông số cho lập trình viên, mà admin tự chỉnh trong phần mềm. Phần lớn thông số sẽ chỉnh được nhờ các module khác (giá ở M3, phí ship ở M9, chính sách 20/40/60 ở M10…). Nhưng rà lại code hiện tại thì còn **một loạt hằng số nghiệp vụ nằm cứng trong file `.ts`** mà không module nào khác chạm tới. Module này gom chúng lại.

**Các hằng số hiện đang nằm trong code — phải chuyển vào DB:**

| Hằng số | Vị trí hiện tại | Ai cần chỉnh |
| --- | --- | --- |
| Bậc hoa hồng affiliate `{0, 6%, 8%, 10%}` | `affiliateTiers` — `lib/operations-store.ts` | `owner` |
| Danh mục chi phí (~25 mục) | `expenseCategories` — `lib/operations-store.ts` | `owner`, `accountant` |
| Phí ship 15.000đ / miễn phí từ 300.000đ | `deliveryFeeFor()` — `lib/operations-store.ts:2084` | `owner` *(M9 chuyển sang bảng quy tắc; M14 lo phần mặc định)* |
| Thời hạn giữ mã thanh toán (15 phút) | biến môi trường `SEPAY_PAYMENT_WINDOW_MINUTES` | `owner` |
| Thời hạn phiên portal (8 giờ) | `PORTAL_SESSION_TTL_SECONDS` — `lib/portal-session.ts` | `owner` |
| Giới hạn đơn: 50 dòng món, 500 phần, 99/dòng | `orderItemsFrom()` — `lib/operations-store.ts` | `owner` |
| Thời gian nhận món tối đa (7 ngày) | `order.create` — `lib/operations-store.ts:2331` | `owner` |
| Ngưỡng chênh lệch quỹ ca bắt buộc giải trình | *(M8 sẽ tạo)* | `owner` |
| Hạn mức công nợ nội bộ mặc định | *(M10 sẽ tạo)* | `owner` |
| Cửa sổ quy kết affiliate (7 ngày), thời hạn khiếu nại (24 giờ) | *(M6 sẽ tạo)* | `owner` |
| Hoa hồng chủ phòng nhóm, số người tối thiểu | *(M5 sẽ tạo)* | `owner` |
| Điểm thưởng hết hạn (12 tháng) | *(M11 sẽ tạo)* | `owner` |
| Thời hạn lưu vị trí shipper (7 ngày) | *(M9 sẽ tạo)* | `owner` — **có ràng buộc pháp lý, đặt trần cứng** |

**Schema.** Hạ tầng `system_settings` đã tạo ở M0; module này bổ sung:

```sql
CREATE TABLE system_settings (          -- tạo ở M0
  key         TEXT NOT NULL,
  scope_type  TEXT NOT NULL DEFAULT 'global',   -- global | site
  scope_value TEXT NOT NULL DEFAULT '*',
  value_json  TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (key, scope_type, scope_value)
);

CREATE TABLE system_setting_history (   -- mọi lần đổi đều có vết
  id TEXT PRIMARY KEY, key TEXT NOT NULL, scope_type TEXT NOT NULL, scope_value TEXT NOT NULL,
  old_value_json TEXT, new_value_json TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL, changed_at TEXT NOT NULL
);
```

**Việc phải làm.**

1. **Sổ đăng ký thông số (`lib/settings-registry.ts`).** Mỗi thông số khai báo một lần: khóa, nhãn tiếng Việt, mô tả, kiểu dữ liệu, giá trị mặc định, **trần và sàn cho phép**, vai trò được sửa, có cho phép ghi đè theo cửa hàng không. Màn hình quản trị sinh tự động từ sổ này — thêm thông số mới chỉ cần thêm một dòng khai báo, không phải sửa giao diện.
2. **Ràng buộc an toàn.** Không phải thông số nào cũng cho chỉnh tự do. Ví dụ: thời hạn lưu vị trí shipper có trần cứng 7 ngày vì lý do bảo vệ dữ liệu cá nhân; bậc hoa hồng không vượt 20% vì sẽ âm biên. Trần/sàn nằm trong sổ đăng ký, không cho vượt kể cả `owner`.
3. **Ghi đè theo cửa hàng.** Một số thông số cho phép đặt riêng từng điểm (phí ship, ngưỡng quỹ ca). Thứ tự giải: giá trị theo `site` → giá trị `global` → mặc định trong sổ đăng ký.
4. **Cache và làm mới.** Đọc thông số phải rẻ (được gọi trong mọi request). Cache trong tiến trình, làm mới khi có thay đổi hoặc sau 60 giây.
5. **Màn hình quản trị** trong portal, nhóm theo chủ đề: Đơn hàng · Thanh toán · Giao vận · Hoa hồng · Kho · Tài chính · Bảo mật. Mỗi thông số hiển thị giá trị hiện tại, giá trị mặc định, ai đổi lần cuối, và nút xem lịch sử.
6. **Quét sạch hằng số.** Rà toàn bộ `lib/` và `app/api/`, chuyển mọi hằng số nghiệp vụ sang `system_settings`. **Không chuyển** những thứ thuộc về hạ tầng hoặc bí mật (chuỗi kết nối DB, khóa API, số vòng băm mật khẩu) — những thứ đó ở lại biến môi trường.

**Ranh giới cần giữ rõ:**

| Loại | Nơi lưu | Ai đổi |
| --- | --- | --- |
| Bí mật (khóa API, secret phiên, mật khẩu DB) | Biến môi trường | Người vận hành hạ tầng |
| Hạ tầng (chuỗi kết nối Postgres, cổng, đường dẫn Railway Volume) | Biến môi trường | Người vận hành hạ tầng |
| **Thông số nghiệp vụ** | **`system_settings`** | **Admin trong phần mềm** |
| Dữ liệu chủ (cửa hàng, món, nhân sự, giá) | Bảng nghiệp vụ riêng | Admin trong phần mềm |

**Định nghĩa hoàn thành.**
- [ ] `grep` toàn bộ `lib/` không còn hằng số nghiệp vụ nào (số tiền, tỷ lệ, ngưỡng, thời hạn) nằm cứng trong code — trừ trần/sàn an toàn khai báo trong sổ đăng ký.
- [ ] Admin đổi bậc hoa hồng affiliate từ 8% sang 9% → đơn tạo sau đó dùng ngay 9%, không cần deploy.
- [ ] Admin đổi phí ship riêng cho cửa hàng Hà Đông → chỉ điểm đó đổi, các điểm khác giữ nguyên.
- [ ] Cố đặt thời hạn lưu vị trí shipper là 90 ngày → bị từ chối vì vượt trần pháp lý.
- [ ] Mọi lần đổi đều có bản ghi trong `system_setting_history` kèm người đổi và giá trị cũ.
- [ ] Vai trò `store-owner` không sửa được thông số toàn hệ thống.
- [ ] `npm run typecheck` / `lint` / `test` — xanh.

**Phụ thuộc:** M0, M1. Các module sau (M5, M6, M8, M9, M10, M11) **có trách nhiệm đăng ký thông số của mình vào sổ**, không tạo hằng số mới trong code. **Ước lượng:** 1–2 người-tuần.

---

### M8 — Thanh toán & quỹ tiền mặt 🟠

> **Mục tiêu:** mọi đồng tiền vào ra đều có chứng từ và đối soát được; tiền mặt không thất thoát.

**Hiện trạng.** VietQR/SePay tốt. Tiền mặt chỉ đánh dấu `paid` khi giao xong (`lib/operations-store.ts:2468`) — **không có quỹ ca, không đếm tiền, không đối soát**. Một mã QR chung cho toàn hệ thống nên không biết tiền về cửa hàng nào.

**Schema.**

```sql
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES work_shifts(id),
  site_id TEXT NOT NULL, movement_type TEXT NOT NULL,   -- sale|refund|drop|float_in|payout|correction
  amount INTEGER NOT NULL, order_id TEXT, reason TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX cash_movements_shift_idx ON cash_movements (shift_id, created_at);

CREATE TABLE bank_reconciliations (
  id TEXT PRIMARY KEY, statement_date TEXT NOT NULL, account_number TEXT NOT NULL,
  opening_balance INTEGER NOT NULL, closing_balance INTEGER NOT NULL,
  matched_count INTEGER NOT NULL DEFAULT 0, unmatched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', reconciled_by TEXT, reconciled_at TEXT
);

ALTER TABLE payment_attempts ADD COLUMN site_id     TEXT;
ALTER TABLE payment_attempts ADD COLUMN payer_label TEXT NOT NULL DEFAULT '';  -- ai trả, cho đơn nhóm chia tiền
ALTER TABLE payment_refunds  ADD COLUMN refund_type TEXT NOT NULL DEFAULT 'full';  -- full | partial
```

**Việc phải làm.**
1. **Bỏ ràng buộc "một đơn một hoàn tiền":** index `payment_refunds_order_unique_idx` (`db/schema.ts:636`) chặn hoàn tiền một phần. Đổi thành cho phép nhiều bản ghi, ràng buộc `SUM(amount) ≤ received_amount`.
2. **Hoàn tiền một phần** cho tình huống thiếu món/sai món.
3. **Quỹ ca:** `shift.open` (nhập tiền đầu ca) → mọi đơn tiền mặt ghi `cash_movements` → `shift.close` (đếm tiền, hệ thống tính chênh lệch, bắt ghi lý do nếu lệch > ngưỡng).
4. **~~QR riêng từng cửa hàng~~ — bỏ.** Đã chốt: **cả 23 cửa hàng dùng chung một tài khoản SePay**. Doanh thu vẫn quy về đúng cửa hàng qua đường `payment_code → payment_attempts.order_id → operation_orders.site_id`. Chỉ cần cột `payment_attempts.site_id` để báo cáo nhanh, không cần sub-account.
5. **Đối soát ngân hàng:** import sao kê (CSV/API SePay), khớp `payment_transactions` ↔ sao kê, báo cáo lệch. Chạy hàng ngày.
6. **COD của shipper:** shipper thu hộ → `cash_movements` gắn shipper → nộp về cửa hàng cuối ca → đối chiếu.
7. **Báo cáo cuối ca**: doanh thu ca, tiền mặt/QR, số bill, chênh lệch quỹ — in được.

**Định nghĩa hoàn thành.**
- [ ] Mở ca → bán 20 đơn (10 mặt, 10 QR) → chốt ca → hệ thống báo đúng số tiền mặt phải có.
- [ ] Thiếu 50.000đ khi chốt ca → bắt buộc nhập lý do, sinh cảnh báo cho chủ cửa hàng.
- [ ] Khách chuyển khoản tại cửa hàng B → doanh thu ghi về đúng site B, dù cả chuỗi dùng chung một tài khoản SePay.
- [ ] Hoàn 1 món trong đơn 5 món → hoàn đúng số tiền, sổ cái khớp.
- [ ] Đối soát sao kê ngày → 100% giao dịch khớp hoặc có danh sách lệch cụ thể.

**Phụ thuộc:** M1, M2, M4. **Ước lượng:** 2–3 người-tuần.

---

### M9 — Giao vận: phí thật, shipper thật, bằng chứng giao hàng 🟠

> **Mục tiêu:** phí ship phản ánh chi phí thật; shipper có công cụ làm việc; có bằng chứng giao hàng khi tranh chấp.

**Hiện trạng.** Phí ship là hằng số 15k/300k (V11). Lalamove tích hợp tốt nhưng chỉ gọi **sau khi đơn đã ready**, nên khách không biết phí thật lúc đặt. Shipper nội bộ chỉ có bật/tắt trạng thái, không có vị trí, không có POD.

**Schema.**

```sql
CREATE TABLE delivery_fee_rules (
  id TEXT PRIMARY KEY, site_id TEXT REFERENCES operation_sites(id),  -- NULL = áp dụng toàn hệ thống
  rule_type TEXT NOT NULL,              -- distance | order_value | time_window
  min_value INTEGER NOT NULL, max_value INTEGER,
  fee INTEGER NOT NULL, free_over_amount INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL, effective_to TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE delivery_proofs (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES operation_orders(id),
  proof_type TEXT NOT NULL,             -- photo | otp | signature
  photo_url TEXT NOT NULL DEFAULT '', otp_verified INTEGER NOT NULL DEFAULT 0,
  recipient_name TEXT NOT NULL DEFAULT '',
  latitude_e6 INTEGER, longitude_e6 INTEGER,
  captured_by TEXT NOT NULL, captured_at TEXT NOT NULL
);

CREATE TABLE shipper_locations (        -- chỉ lưu khi đang có đơn, xóa sau 7 ngày
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT,
  latitude_e6 INTEGER NOT NULL, longitude_e6 INTEGER NOT NULL,
  accuracy_m INTEGER, recorded_at TEXT NOT NULL
);
CREATE INDEX shipper_locations_idx ON shipper_locations (user_id, recorded_at);
```

**Việc phải làm.**
1. **Tính phí thật:** thay `deliveryFeeFor()` (`lib/operations-store.ts:2084`) bằng `resolveDeliveryFee(siteId, distance, orderValue, at)` đọc `delivery_fee_rules`. Khoảng cách tính từ tọa độ điểm bán → tọa độ giao (frontend đã có `distanceBetweenCoordinates`, `app/order/page.tsx:1073` — chuyển sang server).
2. **Báo giá Lalamove trước khi khách chốt:** gọi quote ở bước xem giỏ hàng, hiển thị phí thật; nếu vượt `LALAMOVE_MAX_FEE_VND` thì chuyển sang shipper nội bộ hoặc báo khách.
3. **Bằng chứng giao hàng:** shipper nhập OTP khách đọc **hoặc** chụp ảnh → mới cho chuyển `delivered`. Bắt buộc cho đơn > ngưỡng giá trị.
   > **Ưu tiên OTP hơn ảnh.** OTP giao hàng (4 số, sinh khi đơn chuyển `assigned`, hiển thị cho khách trong màn theo dõi) vừa là bằng chứng mạnh hơn ảnh, vừa không tốn dung lượng. Ảnh chỉ dùng khi khách vắng mặt hoặc gửi tại quầy lễ tân.
   > Ảnh lưu **Railway Volume** qua `lib/storage.ts`, nén phía trình duyệt (1280px, JPEG 70), **giữ 90 ngày rồi xóa** — xem cảnh báo dung lượng ở mục 3.2(a). Đây là nguồn ảnh lớn nhất của hệ thống: 23 điểm × ~50 đơn/ngày.
4. **Vị trí shipper:** gửi định kỳ khi đang giao, cho khách xem trên bản đồ. **Tự động xóa sau 7 ngày** (yêu cầu bảo vệ dữ liệu cá nhân).
5. **Gom tuyến:** gợi ý gộp các đơn cùng hướng cho một shipper (thuật toán đơn giản: cùng quận + chênh giờ hẹn < 20 phút).
6. **Từ chối nhận hàng:** trạng thái `delivery_failed` + quy trình xử lý món (nối M7).

**Định nghĩa hoàn thành.**
- [ ] Đơn giao 1km và đơn giao 6km có phí khác nhau, đúng bảng giá.
- [ ] Khách thấy phí ship **trước khi** bấm thanh toán, và phí đó không đổi khi chốt.
- [ ] Shipper không nhập OTP và cũng không có ảnh → không chuyển được sang "đã giao".
- [ ] Ảnh POD quá 90 ngày bị job dọn xóa; dung lượng volume không tăng vô hạn.
- [ ] Khách theo dõi được vị trí shipper trên bản đồ.
- [ ] Dữ liệu vị trí quá 7 ngày tự động biến mất.

**Phụ thuộc:** M2, M4, M8. **Ước lượng:** 2–3 người-tuần.

---

### M10 — Tài chính, đối soát và tuân thủ 🔴

> **Mục tiêu:** báo cáo tài chính **chỉ chứa số thật**; chủ cửa hàng thấy P&L điểm mình; đối tác đối soát được công nợ; có hóa đơn điện tử.

**Hiện trạng.** Sổ cái và phân bổ có thật và làm tốt. Nhưng: giá vốn là số bịa (V1), giao diện trộn số bịa (V2), công nợ đối tác hiển thị hardcode, không có hóa đơn/thuế.

**Việc phải làm.**

1. **Xóa toàn bộ dữ liệu giả khỏi giao diện — ưu tiên cao nhất, làm ngay được:**
   - Xóa `buildFinanceFallback()` và `financeDemoProducts` (`app/portal/page.tsx:953–1059`).
   - Backend luôn trả mảng thật, kể cả rỗng. UI hiển thị trạng thái rỗng ("Chưa có dữ liệu kỳ này"), **không bịa số**.
   - Xóa `role.metrics/work/alerts/finance/team` hardcode trong `roles` (`app/portal/page.tsx:290–842`).
   - Xóa `LegacyPortalPage` (`app/portal/page.tsx:1286`) — hàm này **được định nghĩa nhưng không nơi nào gọi**, khoảng 180 dòng code chết chuyên hiển thị dữ liệu mẫu.
   > *Việc này có thể tách ra làm trước, độc lập với các module khác, vì rủi ro hiện tại là ai đó tin nhầm số bịa.*

2. **Giá vốn thật:** nối `calculateAllocation` với lô hàng từ M7 (đã mô tả ở M7 mục 3).

3. **Công nợ nội bộ & đối tác:**
```sql
CREATE TABLE internal_accounts (        -- công nợ giữa bếp tổng và từng cửa hàng
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES operation_sites(id),
  balance INTEGER NOT NULL DEFAULT 0,   -- dương = cửa hàng nợ bếp
  credit_limit INTEGER NOT NULL DEFAULT 0,
  last_settled_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE internal_account_entries (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, entry_type TEXT NOT NULL,  -- transfer|payment|adjustment
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  transfer_id TEXT, payment_reference TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
```
   - Vượt hạn mức công nợ → cảnh báo và chặn phiếu điều chuyển mới.

4. **Báo cáo bắt buộc phải có:**
   | Báo cáo | Người xem | Nội dung |
   | --- | --- | --- |
   | P&L theo cửa hàng | `store-owner`, `owner` | Doanh thu − COGS − phí ship − chi phí điểm − hoa hồng = lợi nhuận |
   | P&L bếp tổng | `owner`, `kitchen` | Giá trị xuất − chi phí sản xuất − hao hụt |
   | P&L hợp nhất | `owner` | Toàn chuỗi |
   | Công nợ nội bộ | `owner`, `accountant`, `store-owner` | Số dư từng cửa hàng, tuổi nợ |
   | Đối soát ngân hàng | `accountant` | Khớp/lệch theo ngày |
   | Hoa hồng phải trả | `accountant` | Affiliate + chủ phòng nhóm |
   | Hao hụt & kiểm kê | `owner`, `store-owner` | Theo điểm, theo nguyên nhân |
   | Doanh thu theo món | `owner` | Xếp hạng, biên lợi nhuận thật |

5. **Kỳ đối soát tự động:** thay vì nhập tay `finance.settle` với `grossAmount` gõ tay (`lib/operations-store.ts:2844`), sinh kỳ đối soát **từ sổ cái**: chọn đối tượng + khoảng thời gian → hệ thống tính tổng → duyệt → chi trả. Việc gõ tay số tiền đối soát là lỗ hổng kiểm soát nội bộ.

6. **Khóa sổ kỳ:** sau khi chốt tháng, chặn sửa bút toán kỳ đã khóa; điều chỉnh phải qua bút toán đảo.

7. **Hóa đơn điện tử — ⏸️ HOÃN theo Q6.** Ở đợt này chỉ làm phần khung, **không** tích hợp nhà cung cấp:
   - Tạo bảng `einvoices` và interface `lib/einvoice.ts` với một cài đặt rỗng (`NoopInvoiceProvider`) ghi log thay vì phát hành.
   - Màn hình nhập thông tin xuất hóa đơn (tên, mã số thuế, địa chỉ, email người mua) vẫn làm, lưu vào DB.
   - Báo cáo doanh thu theo kỳ phục vụ kê khai thủ công.
   - **Cảnh báo:** hoãn trong phần mềm không hoãn được nghĩa vụ pháp lý. Khi bán thật vẫn phải xuất hóa đơn bằng cách đang làm hiện nay. Khi nào cắm nhà cung cấp vào, chỉ cần thay `NoopInvoiceProvider` mà không phải sửa nghiệp vụ.

**Định nghĩa hoàn thành.**
- [ ] Không còn bất kỳ số nào trong giao diện tài chính không truy được về một bút toán trong DB.
- [ ] Tắt hết dữ liệu → giao diện tài chính hiển thị 0đ và trạng thái rỗng, không hiện "48,6tr".
- [ ] P&L cửa hàng Mỹ Đình cộng lại đúng bằng P&L hợp nhất phần Mỹ Đình.
- [ ] Công nợ nội bộ khớp với tổng phiếu điều chuyển đã nhận trừ đã thanh toán.
- [ ] Chốt sổ tháng 8 → không sửa được bút toán tháng 8.
- [ ] ~~Xuất hóa đơn điện tử thành công cho một đơn thật.~~ *(hoãn theo Q6 — thay bằng: nhập được thông tin xuất hóa đơn và lưu vào `einvoices`; báo cáo doanh thu theo kỳ xuất được để kê khai thủ công)*

**Phụ thuộc:** M0, M7, M8. **Ước lượng:** 3–4 người-tuần.

---

### M11 — Khách hàng: tài khoản, lịch sử, loyalty, ưu đãi, thông báo 🟡

> **Mục tiêu:** khách có tài khoản thật; các tính năng đang hiển thị số giả (điểm thưởng, voucher, thông báo, đánh giá) có backend thật hoặc bị gỡ khỏi giao diện.

**Hiện trạng.** V10. Tab "Ưu đãi" (`app/order/page.tsx:3150`) hiển thị "04 voucher · đã tiết kiệm 426.000đ" hardcode. `rewardPoints` hiển thị trên mọi món nhưng không cộng vào đâu. 6 thông báo hardcode (`:956`). Rating/reviews sản phẩm hardcode.

**Schema.**

```sql
ALTER TABLE customers ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE customers ADD COLUMN loyalty_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN loyalty_tier   TEXT NOT NULL DEFAULT 'member';
ALTER TABLE customers ADD COLUMN lifetime_value INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN order_count    INTEGER NOT NULL DEFAULT 0;

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  label TEXT NOT NULL, recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL,
  formatted_address TEXT NOT NULL, address_line1 TEXT NOT NULL,
  ward TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
  latitude_e6 INTEGER, longitude_e6 INTEGER, instructions TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE loyalty_transactions (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  points INTEGER NOT NULL,              -- dương = cộng, âm = tiêu
  transaction_type TEXT NOT NULL,       -- earn|redeem|expire|adjust
  order_id TEXT, balance_after INTEGER NOT NULL,
  expires_at TEXT, description TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE promotions (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  promo_type TEXT NOT NULL,             -- percent|fixed|free_ship|free_item|points_multiplier
  value INTEGER NOT NULL, max_discount INTEGER,
  min_order_amount INTEGER NOT NULL DEFAULT 0,
  scope_json TEXT NOT NULL DEFAULT '{}', -- {"siteIds":[],"skus":[],"channels":[],"tiers":[]}
  usage_limit INTEGER, usage_limit_per_customer INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE promotion_redemptions (
  id TEXT PRIMARY KEY, promotion_id TEXT NOT NULL REFERENCES promotions(id),
  customer_id TEXT, order_id TEXT NOT NULL REFERENCES operation_orders(id),
  discount_amount INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX promotion_redemption_order_idx ON promotion_redemptions (promotion_id, order_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL,  -- customer|user
  recipient_id TEXT NOT NULL, category TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, action_url TEXT NOT NULL DEFAULT '',
  entity_type TEXT, entity_id TEXT,
  read_at TEXT, sent_push_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_type, recipient_id, created_at);

CREATE TABLE product_reviews (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_item_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, product_sku TEXT NOT NULL, site_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '', photo_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published',
  reply TEXT NOT NULL DEFAULT '', replied_by TEXT, replied_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX product_reviews_item_idx ON product_reviews (order_item_id);
```

**Việc phải làm.**
1. **Đăng nhập khách bằng SĐT + mật khẩu** (Q3 — đã chốt, dùng chung hạ tầng M1; OTP chỉ dùng lúc đăng ký và quên mật khẩu). **Giữ nguyên guest checkout** — không bắt buộc đăng nhập.
2. **Lịch sử đơn từ server:** `GET /api/customer/orders` thay cho `localStorage`. Ghép đơn cũ đặt bằng SĐT đó khi khách đăng nhập lần đầu.
3. **Địa chỉ đã lưu** chuyển từ cookie thiết bị sang tài khoản (`customer_addresses`); giữ `saved_group_profiles` cho khách chưa đăng nhập.
4. **Loyalty:** cộng điểm khi đơn `delivered` theo `reward_points` của món; điểm hết hạn sau 12 tháng; đổi điểm lấy giảm giá qua `promotions`.
5. **Khuyến mãi:** engine áp mã ở `order.create` — kiểm điều kiện (giá trị tối thiểu, phạm vi điểm bán, số lần dùng), tính `discount_amount` **phía server** (hiện `discountAmount = 0` cứng, `lib/operations-store.ts:2336`).
6. **Thông báo thật:** sinh từ sự kiện (đơn đổi trạng thái, hoa hồng phát sinh, phòng nhóm sắp đóng) + Web Push cho PWA.
7. **Đánh giá:** chỉ khách đã mua món đó mới đánh giá được; rating hiển thị tính từ dữ liệu thật; cửa hàng trả lời được.
8. **Gỡ hoặc nối backend cho các nội dung hardcode còn lại:** `personalProgramDetails` (`:202`), `accountServiceDetails` (`:250`), `actionHubVerses` (`:936`). Nội dung tĩnh (ca dao, mô tả dịch vụ) có thể giữ; nhưng số liệu ("còn 5 lượt", "04 voucher") phải thật hoặc bỏ.

**Định nghĩa hoàn thành.**
- [ ] Khách đăng nhập máy mới → thấy đủ lịch sử đơn và địa chỉ đã lưu.
- [ ] Đặt đơn 100.000đ → cộng đúng số điểm, thấy trong tài khoản.
- [ ] Nhập mã giảm giá → giảm đúng, ghi `promotion_redemptions`, không dùng lại được.
- [ ] Tab "Ưu đãi" hiển thị voucher thật của tài khoản, hoặc trạng thái rỗng.
- [ ] Thông báo đến khi đơn chuyển "đang giao".
- [ ] Rating sản phẩm thay đổi khi có đánh giá mới.

**Phụ thuộc:** M1, M4, M8. **Ước lượng:** 3–4 người-tuần.

---

### M12 — Hiệu năng, realtime và phạm vi API 🟠

> **Mục tiêu:** hệ thống chịu được 23 cửa hàng cùng hoạt động giờ cao điểm.

**Hiện trạng.** V4 (snapshot kéo cả DB), V5 (rate limit trong bộ nhớ).

**Việc phải làm.**
1. **Chia nhỏ snapshot thành các endpoint có phạm vi và phân trang:**
   | Endpoint | Thay thế cho |
   | --- | --- |
   | `GET /api/orders?siteId&status&cursor&limit` | phần `orders` của snapshot |
   | `GET /api/orders/:id` | chi tiết đơn |
   | `GET /api/alerts?role&status&cursor` | phần `alerts` |
   | `GET /api/inventory?siteId` | phần `inventory` |
   | `GET /api/staff?siteId` | phần `members` |
   | `GET /api/sites` | phần `locations` |
   | `GET /api/finance/summary?period&siteId` | phần `finance` |
   - **Lọc bằng `WHERE` trong SQL**, không lọc trong bộ nhớ. `scopeSnapshot()` biến mất.
   - Phân trang bằng cursor (`created_at` + `id`), không dùng `OFFSET`.
   - Giữ `GET /api/operations` như một endpoint tổng hợp mỏng cho tương thích ngược trong lúc chuyển đổi, rồi bỏ.
2. **Realtime bằng SSE:** `GET /api/stream?siteId` phát sự kiện khi có thay đổi trong phạm vi. Bỏ polling 15 giây (`app/portal/page.tsx:1604`). Fallback về polling khi SSE lỗi.
3. **Rate limit dùng chung:** chuyển sang bảng DB (hoặc Redis/KV nếu có). Khóa theo `ip` **và** `user_id`.
4. **Chỉ mục:** rà lại theo truy vấn thật. Cần thêm: `operation_orders (site_id, order_status, created_at)`, `finance_ledger_entries (location_id, occurred_at, entry_type)`, `catalog_site_stock (site_id, status)`.
5. **Cache đọc:** catalog và danh sách điểm bán cache theo ETag (đổi hiếm). Dữ liệu vận hành **không cache**.
6. **Chống N+1:** `backfillExistingOrders()` (`lib/data-integrity.ts:174`) chạy `prepareCustomerRecord` cho **từng đơn một** — với 10.000 đơn sẽ treo. Viết lại thành xử lý theo lô.

**Định nghĩa hoàn thành.**
- [ ] Kiểm tải: 23 cửa hàng × 5 thiết bị × 30 phút giờ cao điểm → p95 API < 300ms.
- [ ] Nhân viên cửa hàng luôn thấy **mọi** đơn của cửa hàng mình, không bị giới hạn 50 đơn toàn hệ thống.
- [ ] Đơn mới xuất hiện trên màn hình bếp < 2 giây, không cần F5.
- [ ] Chạy 2 instance → rate limit vẫn đúng.
- [ ] Truy vấn snapshot cũ không còn trong code.

**Phụ thuộc:** M1, M2. **Ước lượng:** 2–3 người-tuần.

---

### M13 — Vận hành production: giám sát, sao lưu, kiểm thử, pháp lý 🔴

> **Mục tiêu:** chạy thật mà ngủ được; mất dữ liệu thì khôi phục được; sự cố thì biết trước khi khách gọi.

**Việc phải làm.**

1. **Sao lưu & khôi phục.**
   - **`pg_dump` định kỳ** ra `.sql.gz`, đẩy sang nơi lưu **ngoài Railway** — backup nằm cùng chỗ với DB thì mất cả hai cùng lúc. Giữ 30 ngày, mã hóa khi lưu.
   - Bật **point-in-time recovery + snapshot hằng ngày** của Railway.
   - **Không** dùng SQLite làm định dạng sao lưu cho Postgres: phải duy trì lớp dịch schema vĩnh viễn, và bản sao lưu sẽ âm thầm mất dữ liệu mỗi khi schema Postgres đổi mà lớp dịch chưa theo kịp. Lý do đầy đủ ở mục 3.2(b).
   - **Sao lưu Railway Volume** (ảnh món, ảnh chứng từ) — volume không nằm trong backup của database, phải làm riêng.
   - **Diễn tập khôi phục mỗi quý** — backup chưa từng restore thì không phải backup.

2. **Giám sát.**
   - Sentry (hoặc tương đương) cho lỗi runtime.
   - Cảnh báo tự động: healthcheck fail, webhook SePay lỗi > 3 lần, đơn kẹt ở `new` > 15 phút, tồn âm, chênh lệch quỹ ca, công nợ vượt hạn mức.
   - Dashboard vận hành: đơn/giờ theo điểm, thời gian làm món, tỷ lệ đúng giờ, tỷ lệ hủy.
   - Log có `request_id` xuyên suốt.

3. **Kiểm thử.** Bộ test hiện có 8 file — tốt nhưng chưa phủ nghiệp vụ mới. Bổ sung:
   - Test migration: chạy từ DB rỗng và từ DB có dữ liệu cũ.
   - Test phân quyền cho **từng vai trò × từng lệnh** (ma trận, sinh tự động).
   - Test đồng thời: hai người cùng chuyển trạng thái một đơn; hai người cùng nhận một phiếu điều chuyển.
   - Test toàn vẹn tiền: sinh 1.000 đơn ngẫu nhiên → tổng sổ cái = tổng đơn.
   - Test end-to-end: đặt → trả tiền → làm → giao → ghi sổ → đối soát.

4. **CI/CD.** `.github/workflows/ci.yml` đã có. Bổ sung: chạy migration trên DB tạm, kiểm `typecheck` + `lint` + test, chặn merge nếu healthcheck sau deploy không xanh.

5. **Bảo mật.**
   - Rà soát PII: SĐT/email đang lưu thô. Tối thiểu: ghi audit mọi lần đọc PII hàng loạt; xem xét mã hóa cột.
   - Xóa dữ liệu theo yêu cầu (Nghị định 13/2023 về bảo vệ dữ liệu cá nhân): API xóa/ẩn danh khách hàng, giữ dữ liệu kế toán theo luật.
   - Chính sách lưu giữ: vị trí shipper 7 ngày, log 90 ngày, dữ liệu kế toán 10 năm.
   - Quét phụ thuộc (`npm audit`), xoay khóa định kỳ.

6. **Tuân thủ.**
   - Hóa đơn điện tử (M10).
   - An toàn thực phẩm: truy xuất nguồn gốc lô (M7 đã có `batch_code` + `expires_at`) — đảm bảo truy được từ đơn hàng ngược về lô sản xuất và lô nguyên liệu.
   - Điều khoản sử dụng & chính sách riêng tư hiển thị trong app.

7. **Tài liệu vận hành.** Sổ tay xử lý sự cố: mất điện tại cửa hàng, webhook SePay ngừng, DB đầy, khôi phục sau sự cố.

**Định nghĩa hoàn thành.**
- [ ] Khôi phục thành công DB từ backup trên môi trường staging, dữ liệu khớp.
- [ ] Gây lỗi giả → nhận cảnh báo trong vòng 2 phút.
- [ ] Ma trận phân quyền có test tự động, chạy trong CI.
- [ ] Truy được từ một đơn hàng bất kỳ về lô sản xuất và lô nguyên liệu.
- [ ] Có sổ tay sự cố và đã diễn tập ít nhất một lần.

**Phụ thuộc:** tất cả. **Ước lượng:** 3–4 người-tuần (rải song song).

---

## 5. Lộ trình

### 5.1. Đồ thị phụ thuộc

```
M0 (nền móng + PostgreSQL)
 ├─► M1 (danh tính) ──┬─► M2 (mạng lưới) ──┬─► M3 (thực đơn) ──► M4 (đơn hàng)
 │         │          │                     │                      │
 │         └──────────┼──► M14 (cấu hình)   └─► M7 (BẾP TỔNG) ◄────┤
 │                    │        │ (mọi module sau đăng ký thông số vào đây)
 │                    └─► M9 (giao vận) ◄────────────┼─────────────┤
 │                                                   │             │
 ├─► M12 (hiệu năng)                                 │        M8 (thanh toán)
 │                                                   │             │
 │                                          M10 (tài chính) ◄──────┘
 │                                                   │
 └─► M13 (vận hành)                    M5 (nhóm) ────┤
                                       M6 (affiliate)┤
                                       M11 (khách) ──┘
```

### 5.2. Giai đoạn

**Giai đoạn 0 — Dọn rủi ro ngay (3–5 ngày, làm song song, không chặn ai)**
- Xóa `buildFinanceFallback` + `financeDemoProducts` khỏi `app/portal/page.tsx`. **Số bịa trong báo cáo tài chính là rủi ro cao nhất hiện tại.**
- Thêm unique index cho `client_reference` (chặn đơn trùng).
- Gỡ hoặc cài đặt `order.dispatch-external` cho nhất quán.
- Đổi `PORTAL_DEMO_ACCESS_CODE` thành giá trị mạnh, giới hạn IP truy cập `/portal` nếu có thể, cho tới khi M1 xong.
- **Việc hành chính chạy song song, không cần lập trình viên:** nộp hồ sơ đăng ký brandname và template OTP với eSMS. Thủ tục này mất vài ngày đến vài tuần chờ nhà mạng duyệt — nếu đợi tới M1 mới làm thì M1 bị treo.

**Giai đoạn 1 — Nền tảng (M0 → M1 → M2), 8–11 tuần**
Kết quả: chuyển sang PostgreSQL trên Railway, có tài khoản thật cho từng người, 23 cửa hàng thật trong DB, quản trị được từ giao diện.
> Mốc kiểm tra: chủ cửa hàng Hà Đông đăng nhập bằng SĐT + mật khẩu của mình và chỉ thấy dữ liệu Hà Đông.

**Giai đoạn 2 — Bán được hàng thật (M3 → M4 → M14 → M8 → M9), 9–14 tuần**
Kết quả: mở bán thí điểm 1–2 cửa hàng với dữ liệu thật, tiền thật; admin tự chỉnh mọi thông số nghiệp vụ.
> Mốc kiểm tra: chạy song song 2 tuần cùng cách làm hiện tại (sổ giấy/Excel), đối chiếu cuối ngày lệch 0đ.
> M14 đặt sau M4 để đã có thứ thật để cấu hình, nhưng trước M8/M9 để hai module đó đăng ký thông số vào sổ ngay từ đầu thay vì tạo hằng số mới rồi phải dọn lại.

**Giai đoạn 3 — Chuỗi vận hành (M7 → M10), 8–11 tuần**
Kết quả: bếp tổng chạy trên phần mềm, giá vốn thật, tài chính đúng, đối soát được.
> Mốc kiểm tra: một tháng đóng sổ hoàn chỉnh, P&L từng điểm khớp với thực tế.

**Giai đoạn 4 — Tăng trưởng (M5, M6, M11), 7–10 tuần**
Kết quả: đơn nhóm, affiliate, loyalty vận hành thật — các đòn bẩy tăng trưởng anh đã thiết kế trong UI.

**Giai đoạn 5 — Quy mô & an toàn (M12, M13), 5–7 tuần**
Kết quả: mở rộng đủ 23 cửa hàng an toàn.
> Có thể kéo M12 lên sớm hơn nếu triển khai nhanh hơn 8 cửa hàng.

### 5.3. Nguyên tắc triển khai

1. **Không big-bang.** Mỗi module lên production riêng, sau lưng feature flag, bật dần từng cửa hàng.
2. **Chạy song song trước khi cắt.** Cửa hàng thí điểm dùng phần mềm **và** cách cũ trong 2 tuần, đối chiếu số cuối ngày. Chỉ cắt khi lệch bằng 0 trong 5 ngày liên tiếp.
3. **Dữ liệu thật trước tính năng mới.** M2 (23 cửa hàng thật) quan trọng hơn mọi tính năng hào nhoáng.
4. **Đào tạo là một phần của module.** Mỗi module giao kèm hướng dẫn 1 trang cho người dùng cuối bằng tiếng Việt.

---

## 6. Thông số admin tự chỉnh, và thứ vẫn phải cung cấp

### 6.1. Trả lời trực tiếp

**Đúng — gần như toàn bộ thông số ở bản kế hoạch đầu đều do admin chỉnh trong phần mềm**, sau khi module tương ứng xong. Anh không cần chuẩn bị file Excel giao cho lập trình viên. Đó là lý do bản này thêm **M14 — Bảng cấu hình hệ thống**, để cả những hằng số hiện đang nằm cứng trong code cũng chỉnh được.

Nhưng có ba điều phải nói rõ, nếu không sẽ hiểu nhầm rồi vỡ tiến độ:

**Một — "admin chỉnh được" không có nghĩa là "dữ liệu tự có".** Phần mềm cung cấp cái form; vẫn phải có người ngồi nhập 23 cửa hàng, 12 món, và định mức từng món. Công sức nhập liệu không mất đi, chỉ chuyển từ "gửi file cho dev" sang "nhập vào phần mềm". Cái thật sự được là: **sau này sửa không cần deploy**, và người sửa là anh chứ không phải lập trình viên.

**Hai — một số thứ phải có TRƯỚC khi làm module, không phải sau.** Không thể kiểm thử M7 nếu chưa có ít nhất một công thức định mức thật. Không thể kiểm thử giá theo điểm nếu chưa biết điểm đối tác bán chênh bao nhiêu. Ở đây cần **mẫu 1–2 bản ghi thật**, không cần đủ bộ — đủ để xác nhận thiết kế đúng hình dạng dữ liệu thật.

**Ba — có những thứ không phải "thông số" mà là "khóa truy cập bên ngoài".** Không admin nào chỉnh được từ trong phần mềm vì chúng thuộc về nhà cung cấp dịch vụ. Đây mới là danh sách anh thật sự phải cấp.

### 6.2. Thông số admin tự chỉnh — không cần cung cấp

| Thông số | Module mở khóa | Ai chỉnh | Chỉnh ở đâu |
| --- | --- | --- | --- |
| Danh sách cửa hàng, địa chỉ, tọa độ, giờ mở, bán kính phục vụ | M2 | `owner` | Quản trị → Mạng lưới |
| Tạm đóng / mở lại cửa hàng, lịch nghỉ | M2 | `owner`, `store-owner` | Quản trị → Mạng lưới |
| Nhân sự: mời, gán vai trò + cửa hàng, khóa tài khoản | M1, M2 | `owner`, `store-owner` | Quản trị → Tài khoản |
| Thực đơn: thêm/sửa/ẩn món, mô tả, ảnh, topping | M3 | `owner` | Quản trị → Thực đơn |
| Giá bán, giá riêng theo cửa hàng hoặc loại điểm | M3 | `owner` | Quản trị → Thực đơn → Giá |
| Bật/tắt bán từng món tại từng điểm | M3 | `owner`, `store-owner` | Quản trị → Thực đơn |
| Định mức nguyên liệu (BOM) từng món | M7 | `owner`, `kitchen` | Bếp tổng → Định mức |
| Giá giao từ bếp xuống cửa hàng | M3, M7 | `owner` | Quản trị → Giá giao |
| Nhà cung cấp nguyên liệu và giá nhập | M7 | `owner`, `kitchen` | Bếp tổng → Nhà cung cấp |
| Hạn mức công nợ nội bộ từng cửa hàng | M10 | `owner` | Tài chính → Công nợ |
| Chính sách 20/40/60 | có sẵn (`finance.policy.update`) | `owner` | Tài chính → Chính sách giá |
| Bậc hoa hồng affiliate | M14 | `owner` | Cấu hình → Hoa hồng |
| Hoa hồng chủ phòng nhóm, số người tối thiểu | M5 + M14 | `owner` | Cấu hình → Hoa hồng |
| Bảng phí giao hàng theo khoảng cách và giá trị đơn | M9 | `owner` | Quản trị → Giao vận |
| Danh mục chi phí | M14 | `owner`, `accountant` | Cấu hình → Tài chính |
| Ngưỡng chênh lệch quỹ ca, hạn thanh toán, thời hạn phiên | M14 | `owner` | Cấu hình |
| Voucher và chương trình khuyến mãi | M11 | `owner` | Quản trị → Khuyến mãi |
| Tỷ lệ tích điểm, thời hạn điểm | M11 + M14 | `owner` | Cấu hình → Loyalty |

### 6.3. Vẫn phải cung cấp — khóa truy cập dịch vụ ngoài

Không có cách nào admin tự tạo trong phần mềm. Thiếu là **chặn tiến độ**.

| Cần | Dùng cho | Trạng thái |
| --- | --- | --- |
| **Railway project token** | M0 | ✅ **Đã có** trong `.env` (`RAILWAY_PROJECT_TOKEN`) |
| **Chuỗi kết nối PostgreSQL** (`DATABASE_URL`) | M0 | ⏳ Cần tạo dịch vụ Postgres trên Railway rồi lấy chuỗi kết nối |
| **Railway Volume** gắn vào service, để lưu ảnh | M3 | ⏳ Cần tạo volume và đặt đường dẫn mount (ví dụ `/data/uploads`) |
| **SePay**: tài khoản ngân hàng, webhook secret | đã có | ✅ Đang chạy. **Dùng chung một tài khoản cho cả 23 cửa hàng** — không cần sub-account |
| **Lalamove**: API key + secret production | M9 | ⏳ Hiện đang ở sandbox |
| Tên miền và chứng chỉ SSL production | M0 | ⏳ Trước khi mở bán |
| ~~Cloudflare R2~~ | ~~M3~~ | ❌ **Đã bỏ** — ảnh lưu trên Railway Volume |
| ~~eSMS ApiKey / SecretKey / Brandname~~ | ~~M1~~ | ⏸️ **Hoãn** — brandname chưa duyệt. Xây sẵn interface, bật sau khi có |
| ~~Nhà cung cấp hóa đơn điện tử~~ | ~~M10~~ | ⏸️ **Hoãn** theo Q6 |

### 6.4. Vẫn cần — mẫu dữ liệu để kiểm thử khi xây

Không cần đủ bộ. Cần **1–2 bản ghi thật** để xác nhận thiết kế khớp thực tế. Có thể nói miệng hoặc chụp ảnh sổ tay, không cần định dạng gì.

| Mẫu | Module | Câu hỏi cụ thể cần trả lời |
| --- | --- | --- |
| Một cửa hàng chính thống + một điểm đối tác | M2 | Điểm đối tác có gì khác về giờ mở, dịch vụ, cách chia tiền? |
| Một món bán ở cả hai loại điểm | M3 | Chênh giá bao nhiêu? Vì sao chênh — phí mặt bằng hay chiết khấu đối tác? |
| Công thức một món, ví dụ chè bưởi Năm Roi | M7 | Một phần cần bao nhiêu cùi bưởi, đậu xanh, đường? Đơn vị tính là gì? |
| Một phiếu giao hàng bếp → cửa hàng đang làm tay | M7 | Hiện đang ghi gì trên phiếu? Ai ký? Cửa hàng kiểm đếm thế nào? |
| Một ngày chốt quỹ của một cửa hàng | M8 | Đang đếm tiền ra sao? Chênh lệch bao nhiêu thì phải báo? |
| Cách tính hoa hồng đang áp dụng | M5, M6 | Chủ phòng nhóm hiện có được gì không, hay đây là cơ chế mới? |

### 6.5. Dữ liệu thật trong SQLite — kết quả kiểm chứng

Anh cho biết dữ liệu cửa hàng, thực đơn và công thức món trong SQLite là sự thật và có thể lấy từ đó. **Tôi đã kiểm tra và không tìm thấy file đó trong dự án này.**

| Kiểm tra | Kết quả |
| --- | --- |
| `SQLITE_PATH` trong `.env` trỏ tới | `./data/daoche.sqlite` |
| Thư mục `data/` | **Không tồn tại** |
| File SQLite duy nhất tìm thấy | `.wrangler/state/v3/d1/…` — DB cục bộ của Cloudflare/miniflare |
| Nội dung file đó | **2 bảng, không có dữ liệu nghiệp vụ nào** (chỉ `_cf_METADATA`, 1 dòng) |

Nghĩa là: hoặc app chưa từng chạy với SQLite bền vững trên máy này, hoặc file nằm ở nơi khác (máy khác, hoặc trên Railway). `.gitignore` **không** loại trừ `data/`, nên nếu file có ở đây thì đã thấy.

**Nhưng tin tốt: dữ liệu thật vẫn có — nó nằm trong mã nguồn, không nằm trong database.**

| Dữ liệu | Vị trí | Số lượng | Đánh giá |
| --- | --- | --- | --- |
| Điểm bán: tên, loại, địa chỉ, tọa độ, giờ mở, dịch vụ | `app/order/page.tsx:799–921` | **36 điểm** | Địa chỉ và tọa độ Hà Nội trông là thật, dùng được |
| Món: tên, giá, mô tả, thành phần, dị ứng, xuất xứ, dinh dưỡng, mức ngọt, topping + giá topping | `app/order/page.tsx:325–678` | **12 món** | Nội dung chi tiết, rõ ràng là thật |
| SKU chuẩn + giá gốc + giá topping | `lib/catalog-store.ts:37–51` | **13 SKU** | Nguồn giá phía server, dùng được |
| Điểm bán trong seed | `lib/operations-store.ts:709–782` | 4 điểm | Dữ liệu mẫu, **không** dùng |
| **Công thức / định mức nguyên liệu** | — | **0** | **Không tồn tại ở bất kỳ đâu trong dự án** |

Hai điểm cần anh xác nhận:

1. **36 điểm bán trong code so với 23 cửa hàng anh nói** — con số lệch. Đâu là danh sách đúng? Nếu 36 điểm kia là thật thì M2 lấy thẳng từ đó, không cần anh làm gì. Nếu 23 là đúng thì cần biết bỏ những điểm nào.
2. **Công thức món thật sự chưa có ở đâu cả.** Trường `ingredients` của mỗi món chỉ là câu văn liệt kê ("Đậu tương, đường phèn, hoa nhài, lá nếp, trân châu mini"), **không có khối lượng**. M7 cần định mức có số lượng và đơn vị. Đây vẫn là thứ chỉ bếp mới trả lời được.

**Việc làm được ngay, không cần chờ anh:** viết script trích 36 điểm bán và 12 món từ TSX ra `data/seed/*.csv`, để anh mở bằng Excel soát và sửa. Sửa xong thì M2/M3 nạp thẳng vào Postgres. Việc này **độc lập, chạy song song được với M0** (xem mục 9).

### 6.6. Còn chờ anh quyết

| # | Câu hỏi | Chặn module |
| --- | --- | --- |
| — | **File SQLite có dữ liệu thật đang ở đâu?** Nếu có, gửi file để M0 chuyển đổi. Nếu không, dùng phương án trích từ code ở mục 6.5. | M0, M2, M3 |
| — | **36 điểm bán trong code hay 23 cửa hàng — con số nào đúng?** | M2 |
| — | Định mức nguyên liệu từng món — cần bếp cung cấp | M7 |
| — | Giữ SQLite cho test, hay chuyển test sang Postgres luôn? (khuyến nghị: chuyển) | M0 |

---

## 7. Rủi ro chính

| Rủi ro | Mức | Cách giảm |
| --- | --- | --- |
| Số liệu tài chính bịa bị dùng để ra quyết định | **Cao** | Giai đoạn 0 — xóa ngay `buildFinanceFallback` |
| Mã portal dùng chung bị lộ trước khi M1 xong | **Cao** | Đổi mã mạnh, hạn chế IP, ưu tiên M1 |
| Mất dữ liệu do SQLite một file, không backup | **Cao** | M0 quyết định DB; M13 backup — không chờ hết kế hoạch |
| M7 (bếp tổng) phình to vì nghiệp vụ thực tế phức tạp hơn dự kiến | **Cao** | Chia M7 thành 3 đợt: (a) điều chuyển + nhận hàng, (b) sản xuất + giá vốn, (c) kiểm kê + hao hụt. Đợt (a) đã đủ dùng ngay |
| Nhân viên cửa hàng không chịu dùng phần mềm | Trung bình | Chạy song song, đào tạo, giữ nguyên UI đơn giản hiện có |
| Đơn trùng gây mất tiền/mất hàng | Trung bình | Giai đoạn 0 — unique index; M4 — idempotency đầy đủ |
| Chuyển SQLite → Postgres giữa chừng gây downtime | Trung bình | Làm ở M0, khi dữ liệu thật còn ít |
| Vi phạm quy định hóa đơn/thuế khi bán thật | **Cao** *(tăng sau khi hoãn Q6)* | Hoãn tích hợp trong phần mềm không hoãn nghĩa vụ pháp lý. Giai đoạn thí điểm **bắt buộc** dùng cách xuất hóa đơn hiện hành. Cắm nhà cung cấp vào trước khi mở bán diện rộng |
| Chờ duyệt brandname/template eSMS làm treo M1 | Trung bình | Nộp hồ sơ ngay ở Giai đoạn 0, song song với M0 |
| Ba đường chạy database (Postgres + SQLite + D1) lệch cú pháp | Trung bình | Chốt Q9 trước M0. Nếu bỏ D1 thì rủi ro này biến mất |
| Admin chỉnh thông số sai gây thiệt hại (hoa hồng 50%, tồn âm) | Trung bình | M14 đặt trần/sàn an toàn cho từng thông số; mọi thay đổi có nhật ký và người chịu trách nhiệm |

---

## 8. Tóm tắt một trang

**Cái đã có và giữ lại:** luồng đơn lẻ từ giỏ hàng đến giao xong, thanh toán VietQR, giữ/trả/trừ tồn, sổ cái theo basis point, trigger toàn vẹn, phiên ký HMAC, Lalamove. Khoảng 35–40% khối lượng, chất lượng khá.

**Ba thứ chặn đường, phải làm trước:**
1. **M1 — danh tính thật** (bỏ mã dùng chung; SĐT + mật khẩu; phạm vi đọc từ DB).
2. **M2 — 23 cửa hàng thật trong DB** (bỏ 36 điểm hardcode trong TSX).
3. **M7 — bếp tổng** (sản xuất, điều chuyển, giá vốn thật) — nghiệp vụ lõi của anh hiện chưa có dòng code nào.

**Việc làm ngay tuần này, độc lập và rẻ — ba việc này chạy song song được:**
- Xóa `buildFinanceFallback` khỏi `app/portal/page.tsx` để báo cáo tài chính ngừng hiển thị số bịa.
- Thêm unique index cho `client_reference` để ngừng sinh đơn trùng.
- Trích 36 điểm bán và 12 món từ TSX ra CSV để anh soát — vì **dữ liệu thật đang nằm trong mã nguồn, không nằm trong SQLite** (mục 6.5).

**Đường tới production:** Giai đoạn 1 + 2 (17–25 người-tuần) đủ để mở bán thật ở 1–2 cửa hàng thí điểm. Đủ 15 module (37–53 người-tuần) mới vận hành trọn vẹn 23 cửa hàng + bếp tổng. Chạy hai agent song song rút được khoảng 8–12 người-tuần, còn **28–40 tuần** — không chia đôi được vì đường găng `M0 → M1 → M2 → M3 → M4 → M7 → M10` phần lớn là tuần tự (mục 9).

**Về câu hỏi "admin có tự chỉnh được không":** có, và bản này thêm M14 để điều đó đúng với cả những hằng số hiện nằm trong code. Anh vẫn cần cấp **khóa truy cập dịch vụ ngoài** (Postgres URL, Railway Volume, Lalamove) và **định mức nguyên liệu từng món** — thứ duy nhất trong mục 6 mà thật sự chưa tồn tại ở đâu cả.

**Ba việc còn chờ anh:** file SQLite thật đang ở đâu (nếu có) · 36 hay 23 cửa hàng · định mức nguyên liệu từ bếp.

---

## 9. Chạy hai agent song song (Codex + Claude)

### 9.1. Vấn đề thật sự không phải là phụ thuộc module, mà là tranh chấp file

Nhìn đồ thị phụ thuộc thì tưởng nhiều thứ chạy song song được. Nhưng rào cản thật nằm ở chỗ khác: **ba file khổng lồ mà gần như mọi module đều phải sửa.**

| File | Dòng | Bao nhiêu module phải sửa |
| --- | --- | --- |
| `lib/operations-store.ts` | 3.245 | M0, M2, M3, M4, M5, M6, M7, M8, M9, M10, M12, M14 — **12/15** |
| `app/order/page.tsx` | 5.437 | M2, M3, M4, M5, M6, M11 |
| `app/portal/page.tsx` | 2.182 | GĐ0, M1, M2, M3, M4, M7, M8, M10, M14 |

Hai agent cùng sửa `lib/operations-store.ts` là **xung đột merge liên tục**, và tệ hơn là xung đột *ngữ nghĩa*: cả hai đều sửa đúng phần mình mà ghép lại vẫn sai. Vì vậy nguyên tắc số một:

> **Không bao giờ để hai agent cùng sở hữu một file trong cùng một khoảng thời gian.** Phân công theo **quyền sở hữu file**, không phải theo module.

### 9.2. Việc mở khóa song song: tách `lib/operations-store.ts`

Đây là việc đáng làm sớm nhất nếu muốn chạy hai agent. Tách 3.245 dòng thành các module theo miền:

```
lib/operations-store.ts  ──►  lib/orders/commands.ts     (order.create, order.advance, order.assign)
                              lib/orders/queries.ts
                              lib/finance/allocation.ts  (calculateAllocation, ledgerForAllocation)
                              lib/finance/commands.ts    (expense.*, payment.refund, finance.*)
                              lib/inventory/commands.ts  (inventory.adjust, stock)
                              lib/partners/commands.ts   (partner.*, member.*, affiliate.*)
                              lib/snapshot.ts            (d1Snapshot, presentSnapshot, scopeSnapshot)
                              lib/command-router.ts      (điều phối, kiểm quyền chung)
```

Chi phí: khoảng **1 người-tuần**, thuần refactor, không đổi hành vi — test hiện có phải xanh y nguyên.
Lợi: từ chỗ 12/15 module tranh nhau một file, thành **3–4 luồng chạy song song thật sự**.

Làm việc này ngay sau M0. Trước đó thì vô nghĩa vì M0 sẽ viết lại phần lớn các câu SQL trong chính file này. → prompt `SPLIT-BE`, giao Agent A.

**Frontend có nút thắt y hệt.** `app/order/page.tsx` dài **5.436 dòng** và bị **6 module** phải sửa (M2, M3, M4, M5, M6, M11). Tách nó thành `app/order/data/`, `app/order/tabs/`, `app/order/sheets/` là việc **hoàn toàn độc lập với backend** — nên giao Agent B chạy **song song suốt thời gian M0**. → prompt `SPLIT-FE`.

Đây chính là chỗ chia việc sạch nhất của cả kế hoạch: một agent tách backend, một agent tách frontend, không chạm nhau một file nào.

### 9.3. Lịch chạy song song — cập nhật sau khi xong Giai đoạn 0

**Trạng thái hiện tại (2026-08-16):**
- ✅ **GĐ0-A** xóa số bịa tài chính — `app/portal/page.tsx` giảm 2.182 → 1.597 dòng, đã dọn thêm badge/số mẫu và seed Affiliate HA88 khỏi production.
- ✅ **GĐ0-B** chặn đơn trùng — unique index `client_reference` có trong cả `db/schema.ts` và `lib/data-integrity.ts`, xử lý idempotent, `order.dispatch-external` đã gỡ khỏi `OperationsCommand`.
- ⬜ **GĐ0-C** trích dữ liệu ra CSV — chưa làm, là nhiệm vụ thêm sau. Giao Agent B làm đầu tiên.

> **⚠️ Phát hiện khi kiểm tra: M0 lớn hơn ước lượng.**
> **6 trên 9 file test đang phụ thuộc memory fallback** (`lalamove-deliveries`, `operations-api`, `portal-rbac`, `portal-session`, `runtime-database`, `sepay-payments`). M0 bỏ memory fallback nên phải **viết lại cả 6 file này** — chi phí chưa nằm trong ước lượng 4–5 tuần ban đầu. Cộng thêm khoảng **0,5–1 tuần**, thành **5–6 tuần**.
> Hệ quả cho việc chia đôi: **Agent B không được đụng `tests/` trong lúc M0 chạy.**

Điểm mới sau GĐ0: đã có một cách chia **sạch tuyệt đối** cho 5–6 tuần tới — **A giữ toàn bộ backend, B giữ toàn bộ frontend khách.** Hai vùng này không giao nhau một file nào.

| Đợt | Agent A — backend | Agent B — frontend khách | Xung đột? |
| --- | --- | --- | --- |
| **1** *(5–6 tuần)*<br>**song song sạch** | **M0** — PostgreSQL, migration runner, bỏ memory fallback, bỏ Cloudflare, nền `system_settings`, **viết lại 6 file test**<br><sub>Sở hữu `db/`, `lib/`, `scripts/`, `tests/`, `drizzle/`, `app/api/`</sub> | **GĐ0-C** (1 ngày) → **SPLIT-FE**: tách `app/order/page.tsx` 5.436 dòng thành `data/` + `tabs/` + `sheets/`<br><sub>Sở hữu `app/order/` · không đụng `lib/`, `tests/`</sub> | **Không một file nào** |
| **2** *(1 tuần)* | **SPLIT-BE** — tách `lib/operations-store.ts` 3.293 dòng | Tách `app/portal/page.tsx`, hoặc viết `docs/SO_TAY_SU_CO.md` | Không |
| **3** *(3–4 tuần)* | **M1** — danh tính, SĐT + mật khẩu | **M12 phần hạ tầng** — rate limit sang DB, rà chỉ mục, sửa N+1 | Chạm ở migration → dùng dải số riêng |
| **4** *(2–3 tuần)* | **M2** — 23 cửa hàng, nhân sự, ca làm | **M14** — bảng cấu hình hệ thống | Không |
| **5** *(2–3 tuần)* | **M3** — thực đơn, giá theo điểm<br><sub>phần frontend đã dễ hơn nhiều nhờ SPLIT-FE</sub> | **M13 phần sao lưu + giám sát** | Không |
| **6** *(2–3 tuần)* | **M4** — idempotency, sửa đơn, màn hình bếp | Giao diện bếp (KDS) — file component riêng | Cần thỏa thuận ranh giới |
| **7** *(5–7 tuần)*<br>**song song tốt nhất** | **M7 — BẾP TỔNG**, chạy liền mạch | **M8** rồi **M9** | Không |
| **8** *(3–4 tuần)* | **M10** — tài chính | **M5** rồi **M11** | M6 phải sau M10 (cùng chạm `lib/finance/*`) |
| **9** *(3–4 tuần)* | **M6** — affiliate, chi trả | **M12 + M13** phần còn lại | Không |

**Đọc lịch này thế nào.** Đường găng là `M0 → SPLIT-BE → M1 → M2 → M3 → M4 → M7 → M10`, phần lớn tuần tự. Hai agent **không rút ngắn được đường găng**.

Đợt 1 là chỗ song song sạch nhất cả kế hoạch: 5–6 tuần mà hai agent không chạm nhau một file nào. Đợt 7 có giá trị thứ hai: M7 dài 5–7 tuần chạy liền mạch một agent, agent kia làm xong cả M8 và M9.

**Giao ngay hôm nay:**

| Agent | Prompt | Sở hữu file | Thời gian |
| --- | --- | --- | --- |
| **A** | `M0` | `db/`, `lib/`, `scripts/`, `tests/`, `drizzle/`, `app/api/` | 5–6 tuần |
| **B** | `GĐ0-C` → `SPLIT-FE` | chỉ `app/order/` và file mới trong `scripts/`, `data/seed/` | 1 ngày → 1–1,5 tuần |

Sau khi B xong SPLIT-FE mà A vẫn đang chạy M0: giao tiếp cho B tách `app/portal/page.tsx` hoặc viết tài liệu vận hành. **Không giao việc trong `tests/`.**

### 9.4. Quy ước bắt buộc khi chạy hai agent

Không có mấy quy ước này thì hai agent sẽ phá nhau.

1. **Mỗi agent một nhánh git riêng.** Đặt tên `feat/m0-postgres`, `feat/m1-auth`. Không ai làm việc trực tiếp trên `main`.
2. **Ghi rõ quyền sở hữu file vào prompt.** Mỗi prompt phải có mục *"Bạn CHỈ được sửa những file sau: …"* và *"TUYỆT ĐỐI không sửa: …"*. Agent nào cần file ngoài phạm vi thì **dừng lại và báo**, không tự sửa.
3. **Chia dải số migration.** File trong `drizzle/` đánh số tuần tự nên hai agent tạo cùng lúc sẽ đụng số. Agent A dùng dải `0100–0199`, agent B dùng `0200–0299`. Ghép nhánh xong thì đánh số lại một lần.
4. **`db/schema.ts` chỉ được thêm, không sửa dòng cũ** khi hai agent cùng chạy. Mỗi agent thêm bảng của mình vào cuối file.
5. **`lib/settings-registry.ts` (sau M14) là file chung** — mọi module đều thêm thông số vào. Quy ước: chỉ thêm vào cuối, mỗi khai báo một dòng, không sắp xếp lại.
6. **Thứ tự ghép nhánh định trước.** Ai xong trước ghép trước; người sau `rebase` lên `main` mới rồi chạy lại toàn bộ test trước khi ghép. Không dùng `merge` ngược chiều.
7. **Sau mỗi lần ghép, chạy đủ `npm run typecheck && npm run lint && npm test`.** Đỏ thì lùi lại, không tích lũy nợ.
8. **Không agent nào được nới lỏng test của agent khác** để nhánh mình xanh. Test đỏ thì sửa code, hoặc báo lại.

