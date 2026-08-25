import { Copy, MessageCircleMore, QrCode, Send, Share2, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type AffiliateShareSheetProps = { model: OrderController };

export default function AffiliateShareSheet({ model }: AffiliateShareSheetProps) {
  const { affiliateAccount, referralMessage, setShowAffiliateShare, shareReferralTo, showAffiliateShare } = model;
  return (showAffiliateShare && (
        <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setShowAffiliateShare(false)}>
          <section className={`${styles.sheet} ${styles.shareSheet}`} role="dialog" aria-modal="true" aria-labelledby="share-affiliate-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div><small>CHIA SẺ LINK AFFILIATE</small><h2 id="share-affiliate-title">Bạn muốn gửi khách qua đâu?</h2></div>
              <button type="button" aria-label="Đóng" onClick={() => setShowAffiliateShare(false)}><X size={20} /></button>
            </div>
            <p className={styles.sheetCopy}>Mỗi lượt mở link và đơn giao thành công đều được ghi nhận minh bạch về mã {affiliateAccount?.code || "Affiliate"} của bạn.</p>
            <div className={styles.shareChannelGrid}>
              <button type="button" onClick={() => shareReferralTo("zalo")}><span>Z</span><strong>Zalo</strong><small>Nhóm & cá nhân</small></button>
              <button type="button" onClick={() => shareReferralTo("facebook")}><span>f</span><strong>Facebook</strong><small>Bài viết & nhóm</small></button>
              <button type="button" onClick={() => shareReferralTo("sms")}><span><MessageCircleMore size={20} /></span><strong>Tin nhắn</strong><small>SMS trực tiếp</small></button>
              <button type="button" onClick={() => shareReferralTo("email")}><span><Send size={20} /></span><strong>Email</strong><small>Văn phòng</small></button>
              <button type="button" onClick={() => shareReferralTo("copy")}><span><Copy size={20} /></span><strong>Sao chép</strong><small>Dán ở bất kỳ đâu</small></button>
              <button type="button" onClick={() => shareReferralTo("other")}><span><Share2 size={20} /></span><strong>Ứng dụng khác</strong><small>TikTok, Messenger…</small></button>
            </div>
            <div className={styles.sharePreview}>
              <QrCode size={24} />
              <div><small>NỘI DUNG ĐÍNH KÈM</small><p>{referralMessage}</p><strong>Mã {affiliateAccount?.code || "Affiliate"} · mở thẳng trang đặt món</strong></div>
            </div>
          </section>
        </div>
      ));
}
