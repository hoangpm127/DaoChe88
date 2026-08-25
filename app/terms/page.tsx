import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Điều khoản sử dụng | Đảo Chè" };

export default function TermsPage() {
  return <main className={styles.page}><article className={styles.document}>
    <p className={styles.eyebrow}>Đảo Chè · Điều khoản</p>
    <h1>Một thỏa thuận rõ ràng cho mỗi đơn món.</h1>
    <p className={styles.updated}>Phiên bản 2026-08-21 · Có hiệu lực từ 21/08/2026</p>
    <section><h2>1. Phạm vi dịch vụ</h2><p>Đảo Chè cung cấp chức năng xem thực đơn, chọn điểm phục vụ, đặt món, thanh toán, theo dõi giao nhận, tích điểm và gửi yêu cầu hỗ trợ. Khả năng phục vụ phụ thuộc giờ mở cửa, vùng giao hàng, tồn món và công suất của điểm được chọn.</p></section>
    <section><h2>2. Giá và thanh toán</h2><p>Giá, phí giao hàng, giảm giá và tổng thanh toán hiển thị ở bước xác nhận là dữ liệu do máy chủ tính. Giao dịch VietQR chỉ được coi là hoàn tất khi hệ thống nhận và đối chiếu được khoản tiền; tiền mặt được ghi nhận theo quy trình ca và giao nhận.</p></section>
    <section><h2>3. Đặt, sửa và hủy đơn</h2><p>Bạn cần cung cấp thông tin nhận món chính xác. Khả năng sửa hoặc hủy phụ thuộc trạng thái chế biến, giao nhận và thanh toán. Khoản hoàn, nếu có, không vượt số tiền hệ thống đã ghi nhận cho đơn.</p></section>
    <section><h2>4. Tài khoản và sử dụng hợp lệ</h2><ul><li>Không dùng thông tin của người khác hoặc can thiệp vào vận hành của điểm bán.</li><li>Không lạm dụng mã giới thiệu, ưu đãi, đánh giá hay gửi yêu cầu tự động quá mức.</li><li>Bảo mật thiết bị và thông tin đăng nhập; báo hỗ trợ khi nghi ngờ tài khoản bị sử dụng trái phép.</li></ul></section>
    <section><h2>5. Chất lượng và hỗ trợ</h2><p>Khi món, thanh toán hoặc giao nhận có vấn đề, hãy gửi yêu cầu trong ứng dụng kèm mã đơn. Chúng tôi đối chiếu dấu vết đơn hàng, thanh toán và giao nhận để xử lý theo tình trạng thực tế.</p></section>
    <section><h2>6. Dữ liệu cá nhân</h2><p>Việc thu thập, sử dụng, thời hạn lưu và quyền của bạn được mô tả trong <Link href="/privacy">Chính sách quyền riêng tư</Link>. Việc đồng ý chính sách được ghi nhận cùng thời gian và phiên bản tại bước đặt đơn.</p></section>
    <section><h2>7. Thay đổi điều khoản</h2><p>Khi nội dung thay đổi đáng kể, phiên bản và ngày hiệu lực mới sẽ được công bố tại trang này. Đơn đã xác nhận vẫn giữ giá trị tiền và dữ liệu nghiệp vụ tại thời điểm tạo.</p></section>
    <Link className={styles.back} href="/order">Trở lại đặt món</Link>
  </article></main>;
}
