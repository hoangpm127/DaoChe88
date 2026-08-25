# Hướng dẫn nhanh theo vai trò

## Admin tổng (`owner`, `super-admin`)

- Theo dõi `/api/monitoring/summary`, cảnh báo mở, sức khỏe database và tiến độ đối soát.
- Gán vai trò/site theo nguyên tắc quyền tối thiểu; không dùng chung tài khoản.
- Duyệt hoàn tiền, chi phí, kiểm kê, hạn mức và đóng kỳ qua đúng workflow.
- Chỉ ẩn danh hóa khách sau khi xác minh yêu cầu; không xóa đơn hoặc ledger.
- Mỗi ca kiểm tra đơn kẹt, tồn bất thường, công nợ vượt hạn và quỹ lệch.

## Chủ cửa hàng (`store-owner`)

- Chỉ thấy và thao tác các site được gán trong tài khoản.
- Mở/đóng ca, theo dõi đơn mới, công suất, tồn món và quỹ tại site.
- Điều chỉnh tồn qua nghiệp vụ kiểm kê/hao hụt/điều chuyển, không sửa số trực tiếp.
- Chênh lệch quỹ vượt ngưỡng phải có giải trình và chứng từ.

## Nhân viên cửa hàng (`store-staff`)

- Nhận đơn, xác nhận bước chuẩn bị/nhận món và xử lý yêu cầu trong ca.
- Đối chiếu tên/mã đơn vừa đủ; không chụp hoặc gửi danh sách khách ra ngoài portal.
- Báo quản lý khi đơn `new` quá 15 phút, thiếu hàng hoặc số tiền không khớp.

## Bếp (`kitchen`)

- Thao tác theo từng dòng món trong KDS; chỉ đánh dấu xong khi món thực sự hoàn thành.
- Ghi nhận mẻ, lô, hao hụt và điều chuyển theo FEFO.
- Không dùng lô hết hạn; chênh lệch kiểm kê phải có lý do.

## Shipper (`shipper`)

- Chỉ thấy đơn được gán. Xác nhận nhận hàng, đang giao, giao thành công/thất bại theo thứ tự.
- Chia sẻ vị trí chỉ khi đang giao; POD/OTP dùng cho đúng đơn.
- Tiền COD phải gắn với đơn và nộp qua quy trình remit trước khi chốt.

## Kế toán (`accountant`, `finance`)

- Đối chiếu payment, sao kê, ledger, chi phí và settlement bằng mã tham chiếu.
- Không sửa tiền đơn đã tạo; dùng refund/amendment/correction.
- Không xem PII nếu nghiệp vụ tài chính không cần. Xuất dữ liệu phải có mục đích và audit.
- Chỉ đóng kỳ sau khi ngân hàng, quỹ, công nợ và hóa đơn deferred đã được rà soát.

## Kiểm soát (`control`)

- Đọc audit và báo cáo; tách biệt người tạo/người duyệt.
- Điều tra theo request ID, entity ID và event log; không đưa PII vào biên bản ngoài hệ thống.
- Resolve cảnh báo chỉ khi có chứng cứ khắc phục.

## Điều phối và quản lý vùng

- Điều phối theo site, SLA và tuyến; không mở rộng phạm vi phiên để “xem cho tiện”.
- Khi SSE mất, portal tự polling 30 giây; tải lại và báo kỹ thuật nếu trạng thái không đổi.
- Lalamove chỉ dispatch bằng capability riêng và theo báo giá đã khóa.

## Mọi vai trò

- Khóa màn hình khi rời thiết bị, đăng xuất thiết bị lạ, không chia sẻ mật khẩu.
- Không gửi secret, ảnh giấy tờ, số điện thoại, địa chỉ hoặc sao kê vào nhóm chat.
- Khi có lỗi: ghi thời gian, mã đơn/request ID, hành động vừa làm; làm theo `docs/SO_TAY_SU_CO.md`.
