import { ArrowRight, CheckCircle2, ChevronDown, Send, ShieldCheck, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type AffiliateApplicationSheetProps = { model: OrderController };

export default function AffiliateApplicationSheet({ model }: AffiliateApplicationSheetProps) {
  const { affiliateApplicationSent, affiliateDraft, goTo, setAffiliateDraft, setShowAffiliateApplication, showAffiliateApplication, submitAffiliateApplication } = model;
  return (showAffiliateApplication && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowAffiliateApplication(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.affiliateApplicationSheet}`} role="dialog" aria-modal="true" aria-labelledby="affiliate-application-title">
            <div className={styles.sheetGrabber} />
            {affiliateApplicationSent ? (
              <div className={styles.applicationSuccess}>
                <span>
                  <CheckCircle2 size={34} />
                </span>
                <small>ĐÃ NHẬN ĐĂNG KÝ</small>
                <h2 id="affiliate-application-title">Chào mừng Đại sứ tương lai!</h2>
                <p>Đội ngũ Đảo Chè sẽ xác minh thông tin và liên hệ với bạn trong vòng 01 ngày làm việc.</p>
                <button className={styles.primaryButton} type="button" onClick={() => { setShowAffiliateApplication(false); goTo("affiliate"); }}>
                  Xem cách tính thu nhập <ArrowRight size={17} />
                </button>
              </div>
            ) : (
              <form onSubmit={submitAffiliateApplication}>
                <div className={styles.sheetHeading}>
                  <div>
                    <small>GIỚI THIỆU KHÁCH · THU NHẬP MINH BẠCH</small>
                    <h2 id="affiliate-application-title">Đăng ký Đại sứ cộng đồng</h2>
                  </div>
                  <button type="button" aria-label="Đóng" onClick={() => setShowAffiliateApplication(false)}>
                    <X size={20} />
                  </button>
                </div>
                <p className={styles.sheetCopy}>Không thu phí, không thưởng tuyển người. Bạn chỉ nhận phần chia sẻ từ những đơn thật đã giao thành công.</p>
                <div className={styles.applicationTiers}>
                  <span><b>6%</b><small>Mức cơ bản</small></span>
                  <span><b>8%</b><small>Mức tiêu chuẩn</small></span>
                  <span><b>10%</b><small>Theo chiến dịch</small></span>
                </div>
                <div className={styles.applicationFormGrid}>
                  <label>
                    <span>Họ và tên *</span>
                    <input value={affiliateDraft.name} onChange={(event) => setAffiliateDraft({ ...affiliateDraft, name: event.target.value })} placeholder="Tên của bạn" />
                  </label>
                  <label>
                    <span>Số điện thoại *</span>
                    <input inputMode="tel" value={affiliateDraft.phone} onChange={(event) => setAffiliateDraft({ ...affiliateDraft, phone: event.target.value })} placeholder="0912 345 678" />
                  </label>
                  <label>
                    <span>Cộng đồng bạn kết nối</span>
                    <select value={affiliateDraft.community} onChange={(event) => setAffiliateDraft({ ...affiliateDraft, community: event.target.value })}>
                      <option>Văn phòng / cơ quan</option>
                      <option>Tòa nhà / khu dân cư</option>
                      <option>Quán cà phê / nhà hàng</option>
                      <option>Bạn bè / gia đình</option>
                    </select>
                    <ChevronDown size={16} />
                  </label>
                  <label>
                    <span>Quy mô dự kiến</span>
                    <input value={affiliateDraft.reach} onChange={(event) => setAffiliateDraft({ ...affiliateDraft, reach: event.target.value })} placeholder="VD: Văn phòng khoảng 80 người" />
                  </label>
                </div>
                <div className={styles.applicationRule}>
                  <ShieldCheck size={18} />
                  <p>Mốc 8% và 10% được áp dụng ngược cho toàn bộ đơn hợp lệ trong tháng khi bạn đạt đủ số ly.</p>
                </div>
                <button className={styles.primaryButton} type="submit">
                  Gửi đăng ký <Send size={17} />
                </button>
              </form>
            )}
          </section>
        </div>
      ));
}
