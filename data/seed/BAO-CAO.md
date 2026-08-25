# Báo cáo trích dữ liệu seed

## Kết quả

- Điểm bán: **36** bản ghi, đọc từ `app/order/data/stores.ts`.
- Địa điểm giao hàng văn phòng: **3** bản ghi, đọc từ `app/order/data/stores.ts` (chỉ đối chiếu trong báo cáo vì nhiệm vụ không yêu cầu CSV riêng).
- Món hiển thị cho khách: **12** bản ghi, đọc từ `app/order/data/products.ts`.
- Món trong catalog chuẩn: **13** bản ghi, gồm 1 SKU chỉ dùng kiểm thử.
- Topping chuẩn: **34** bản ghi.

Các tệp CSV dùng UTF-8 có BOM để mở trực tiếp bằng Excel mà không mất dấu tiếng Việt.

## Chênh lệch cần chủ hệ thống xác nhận

Mã nguồn hiện có **36 điểm bán**, trong khi chủ hệ thống cho biết chuỗi có **23 cửa hàng**. Vui lòng đánh dấu các điểm còn hoạt động trong danh sách đầy đủ dưới đây; không nên nạp vào cơ sở dữ liệu chính thức trước khi chốt danh sách.

01. [ ] Đảo Chè Mỹ Đình — Cửa hàng chính thống — Số 18 Nguyễn Hoàng, Mỹ Đình 2, Nam Từ Liêm, Hà Nội
02. [ ] Express Keangnam — Điểm bán chính thống — Sảnh A, Keangnam Landmark 72, Phạm Hùng, Hà Nội
03. [ ] Mộc Coffee · Gardenia — Đối tác Affiliate — Shop S2-03, Vinhomes Gardenia, Hàm Nghi, Hà Nội
04. [ ] Bếp Việt 24 · Cầu Giấy — Đối tác phân phối — 88 Trần Thái Tông, Dịch Vọng Hậu, Cầu Giấy, Hà Nội
05. [ ] Lá Coffee · Tây Hồ — Đối tác Affiliate — 19 ngõ 67 Tô Ngọc Vân, Quảng An, Tây Hồ, Hà Nội
06. [ ] Đảo Chè Mễ Trì — Cửa hàng chính thống — 46 Mễ Trì Hạ, Nam Từ Liêm, Hà Nội
07. [ ] Bếp nhanh Phạm Hùng — Điểm bán chính thống — Số 7 Phạm Hùng, Nam Từ Liêm, Hà Nội
08. [ ] Nếp Coffee · Đình Thôn — Đối tác Affiliate — 32 Đình Thôn, Mỹ Đình 1, Nam Từ Liêm, Hà Nội
09. [ ] Đảo Chè Trần Duy Hưng — Cửa hàng chính thống — 128 Trần Duy Hưng, Trung Hòa, Cầu Giấy, Hà Nội
10. [ ] Mây Café · Yên Hòa — Đối tác Affiliate — 19 Vũ Phạm Hàm, Yên Hòa, Cầu Giấy, Hà Nội
11. [ ] Bếp Nhà 88 · Trung Kính — Đối tác phân phối — 57 Trung Kính, Trung Hòa, Cầu Giấy, Hà Nội
12. [ ] Đảo Chè Xuân Thủy — Điểm bán chính thống — 165 Xuân Thủy, Dịch Vọng Hậu, Cầu Giấy, Hà Nội
13. [ ] An Coffee · Hồ Tùng Mậu — Đối tác Affiliate — 92 Hồ Tùng Mậu, Mai Dịch, Cầu Giấy, Hà Nội
14. [ ] Đảo Chè Nhổn — Điểm bán chính thống — 218 Nhổn, Bắc Từ Liêm, Hà Nội
15. [ ] Hub Xuân Phương — Cửa hàng chính thống — 67 Trịnh Văn Bô, Xuân Phương, Nam Từ Liêm, Hà Nội
16. [ ] Đảo Chè Hà Đông — Cửa hàng chính thống — 86 Trần Phú, Mộ Lao, Hà Đông, Hà Nội
17. [ ] Góc Nhỏ Café · Văn Quán — Đối tác Affiliate — B14 Văn Quán, Hà Đông, Hà Nội
18. [ ] Express Sân vận động Mỹ Đình — Điểm bán chính thống — Đường Lê Đức Thọ, Mỹ Đình 1, Nam Từ Liêm, Hà Nội
19. [ ] Skylake Pantry · Phạm Hùng — Đối tác phân phối — Vincom Skylake, 50 Phạm Hùng, Nam Từ Liêm, Hà Nội
20. [ ] Đảo Chè Royal City — Điểm bán chính thống — 72A Nguyễn Trãi, Thanh Xuân, Hà Nội
21. [ ] Bếp Việt · Thanh Xuân — Đối tác phân phối — 118 Nguyễn Tuân, Thanh Xuân, Hà Nội
22. [ ] Mầm Coffee · Láng Hạ — Đối tác Affiliate — 61 Láng Hạ, Đống Đa, Hà Nội
23. [ ] Đảo Chè Giảng Võ — Cửa hàng chính thống — 148 Giảng Võ, Ba Đình, Hà Nội
24. [ ] Lá Nếp · Linh Đàm — Đối tác Affiliate — HH2A Linh Đàm, Hoàng Mai, Hà Nội
25. [ ] Đảo Chè Cầu Diễn — Điểm bán chính thống — 106 Cầu Diễn, Bắc Từ Liêm, Hà Nội
26. [ ] Nhà Mình Café · Tây Mỗ — Đối tác Affiliate — 33 Tây Mỗ, Nam Từ Liêm, Hà Nội
27. [ ] Đảo Chè Smart City — Điểm bán chính thống — S2.05 Vinhomes Smart City, Tây Mỗ, Hà Nội
28. [ ] Nếp Mới · Mộ Lao — Đối tác Affiliate — KĐT Mộ Lao, Hà Đông, Hà Nội
29. [ ] Đảo Chè Vạn Phúc — Điểm bán chính thống — 48 Vạn Phúc, Hà Đông, Hà Nội
30. [ ] Trạm Xanh · Ngọc Khánh — Đối tác phân phối — 21 Phạm Huy Thông, Ba Đình, Hà Nội
31. [ ] Đảo Chè Bưởi — Điểm bán chính thống — 238 đường Bưởi, Ba Đình, Hà Nội
32. [ ] Mây Hồ Tây · Lạc Long Quân — Đối tác Affiliate — 287 Lạc Long Quân, Tây Hồ, Hà Nội
33. [ ] Đảo Chè Long Biên — Cửa hàng chính thống — 56 Nguyễn Văn Cừ, Long Biên, Hà Nội
34. [ ] Phố Nhỏ Café · Gia Lâm — Đối tác Affiliate — 102 Ngô Xuân Quảng, Trâu Quỳ, Gia Lâm, Hà Nội
35. [ ] Đảo Chè Đông Anh — Điểm bán chính thống — 68 Cao Lỗ, Uy Nỗ, Đông Anh, Hà Nội
36. [ ] Đảo Chè Hoài Đức — Đối tác phân phối — KĐT Geleximco, An Khánh, Hoài Đức, Hà Nội

Đối chiếu thực đơn:

- Có trong giao diện nhưng không có trong `BOOTSTRAP_CATALOG`: Không có.
- Có trong `BOOTSTRAP_CATALOG` nhưng không có trong giao diện: `TEST-SEPAY-2K` — Kiểm thử webhook SePay 2.000đ (chỉ kiểm thử).
- Loại điểm bán chưa ánh xạ được: Không có.
- Điểm bán không suy ra được quận/huyện từ chính chuỗi địa chỉ: Express Keangnam, Mộc Coffee · Gardenia, Đảo Chè Smart City.

## Dữ liệu còn thiếu

- `owner_phone` và `capacity_per_hour` không có trong mã nguồn, nên được để trống trong `cua-hang.csv` để chủ hệ thống điền sau.
- **KHÔNG tìm thấy dữ liệu công thức/định mức nguyên liệu ở bất kỳ đâu trong dự án.** Trường `ingredients` chỉ là câu văn liệt kê thành phần, không có khối lượng. Module M7 cần bếp cung cấp định mức có số lượng và đơn vị.
- Cột quận/huyện chỉ được trích khi tên quận/huyện xuất hiện nguyên văn trong địa chỉ; script không tự bịa hoặc tra cứu bên ngoài.
