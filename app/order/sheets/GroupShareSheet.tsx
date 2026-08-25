import { Copy, MessageCircleMore, QrCode, Share2, Smartphone, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type GroupShareSheetProps = { model: OrderController };

export default function GroupShareSheet({ model }: GroupShareSheetProps) {
  const { groupCountdown, groupRoom, setShowGroupShare, shareGroupTo, showGroupShare } = model;
  return (showGroupShare && groupRoom && (
        <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setShowGroupShare(false)}>
          <section className={`${styles.sheet} ${styles.shareSheet} ${styles.groupShareSheet}`} role="dialog" aria-modal="true" aria-labelledby="share-group-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div><small>CHIA SẺ PHÒNG · CÒN {groupCountdown}</small><h2 id="share-group-title">Gọi cả nhóm vào chọn món</h2></div>
              <button type="button" aria-label="Đóng" onClick={() => setShowGroupShare(false)}><X size={20} /></button>
            </div>
            <p className={styles.sheetCopy}>Link mở thẳng phòng {groupRoom.code}. Mỗi người chỉ cần điền tên, chọn món và gửi trước khi hết 5 phút.</p>
            <div className={styles.shareChannelGrid}>
              <button type="button" onClick={() => shareGroupTo("zalo")}><span>Z</span><strong>Zalo</strong><small>Nhóm công ty</small></button>
              <button type="button" onClick={() => shareGroupTo("facebook")}><span>f</span><strong>Facebook</strong><small>Nhóm & bài viết</small></button>
              <button type="button" onClick={() => shareGroupTo("messenger")}><span><MessageCircleMore size={20} /></span><strong>Messenger</strong><small>Gửi trực tiếp</small></button>
              <button type="button" onClick={() => shareGroupTo("sms")}><span><Smartphone size={20} /></span><strong>Tin nhắn</strong><small>SMS nhanh</small></button>
              <button type="button" onClick={() => shareGroupTo("copy")}><span><Copy size={20} /></span><strong>Sao chép</strong><small>Dán ở mọi nơi</small></button>
              <button type="button" onClick={() => shareGroupTo("other")}><span><Share2 size={20} /></span><strong>Ứng dụng khác</strong><small>Chia sẻ hệ thống</small></button>
            </div>
            <div className={styles.groupSharePreview}>
              <QrCode size={27} />
              <div><small>PHÒNG {groupRoom.code}</small><strong>{groupRoom.office}</strong><p>Hết 5 phút, link tự khóa nhận món.</p></div>
              <b>{groupCountdown}</b>
            </div>
          </section>
        </div>
      ));
}
