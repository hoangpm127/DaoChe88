import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = { title: "Chính sách quyền riêng tư | Đảo Chè" };

export default function PrivacyPage() {
  return <main className={styles.page}><article className={styles.document}>
    <p className={styles.eyebrow}>Đảo Chè · Quyền riêng tư</p>
    <h1>Dữ liệu vừa đủ để làm món và giao đúng người.</h1>
    <p className={styles.updated}>Phiên bản 2026-08-21 · Có hiệu lực từ 21/08/2026</p>
    <section><h2>1. Dữ liệu được xử lý</h2><ul><li>Tên, số điện thoại, email và địa chỉ nhận món do bạn cung cấp.</li><li>Nội dung đơn, thanh toán, giảm giá, điểm thưởng, đánh giá và yêu cầu hỗ trợ.</li><li>Tọa độ giao hàng khi bạn chọn giao tận nơi; vị trí shipper chỉ trong lúc giao đơn.</li><li>Dữ liệu kỹ thuật tối thiểu để bảo mật, chống lạm dụng và ghi dấu vết truy cập.</li></ul></section>
    <section><h2>2. Mục đích</h2><p>Dữ liệu được dùng để nhận và thực hiện đơn, tính phí, thanh toán và đối soát, giao nhận, chăm sóc khách hàng, quản lý điểm thưởng, phát hiện gian lận, bảo vệ hệ thống và thực hiện nghĩa vụ kế toán hoặc nghĩa vụ pháp lý liên quan.</p></section>
    <section><h2>3. Chia sẻ</h2><p>Thông tin chỉ được chuyển cho điểm phục vụ, nhân sự giao nhận và nhà cung cấp thanh toán/giao hàng ở mức cần thiết cho giao dịch. Chúng tôi không bán dữ liệu cá nhân. Việc truy cập PII trong portal được giới hạn theo vai trò, site và ghi audit.</p></section>
    <section><h2>4. Thời hạn lưu</h2><ul><li>Vị trí shipper: tối đa 7 ngày; ảnh bằng chứng giao hàng: tối đa 90 ngày.</li><li>Nhật ký ứng dụng: 90 ngày; khóa chống gửi lặp: 7 ngày; thử thách OTP: 1 ngày.</li><li>Chứng từ và dữ liệu kế toán được giữ 10 năm hoặc lâu hơn nếu pháp luật yêu cầu.</li><li>Dữ liệu nhận dạng được ẩn danh khi yêu cầu hợp lệ đã được xác minh, trừ phần phải giữ cho kế toán và giải quyết tranh chấp.</li></ul></section>
    <section><h2>5. Quyền của bạn</h2><p>Bạn có thể yêu cầu xem, sửa, rút lại đồng ý không bắt buộc hoặc ẩn danh hóa dữ liệu qua mục hỗ trợ. Trước khi xử lý yêu cầu có ảnh hưởng tới tài khoản hoặc lịch sử đơn, chúng tôi cần xác minh đúng chủ thể để tránh lộ dữ liệu cho người khác.</p></section>
    <section><h2>6. An toàn dữ liệu</h2><p>Hệ thống dùng phiên máy chủ có thể thu hồi, phân quyền theo vai trò và điểm bán, mã hóa đường truyền, rate limit dùng chung giữa các instance, nhật ký truy cập PII, sao lưu mã hóa và quy trình ứng phó sự cố.</p></section>
    <section><h2>7. Cơ sở tham chiếu</h2><p>Chính sách được xây dựng có tham chiếu <a href="https://vanban.chinhphu.vn/?classid=1&docid=207759&orggroupid=2&pageid=27160" target="_blank" rel="noreferrer">Nghị định 13/2023/NĐ-CP</a> và <a href="https://xaydungchinhsach.chinhphu.vn/luat-bao-ve-du-lieu-ca-nhan.html" target="_blank" rel="noreferrer">Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15</a>, có hiệu lực từ 01/01/2026.</p></section>
    <section><h2>8. Liên hệ</h2><p>Gửi yêu cầu trong mục Tài khoản → Dữ liệu &amp; quyền riêng tư hoặc mục Hỗ trợ của ứng dụng. Luôn kèm mã đơn nếu yêu cầu liên quan một giao dịch cụ thể.</p></section>
    <Link className={styles.back} href="/order">Trở lại đặt món</Link>
  </article></main>;
}
