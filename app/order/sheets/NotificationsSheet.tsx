import { Bell, BellOff, LogIn, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type NotificationsSheetProps = { model: OrderController };

/**
 * Thông báo thật, sinh từ sự kiện đơn hàng ở phía máy chủ (M11) và đọc qua
 * GET /api/customers/me.
 *
 * Bản trước hiển thị 6 thông báo viết cứng trong mã nguồn — kèm mã đơn, tên
 * shipper và biển số xe không có thật — cho mọi người truy cập, kể cả người
 * chưa từng đặt đơn nào.
 */
function relativeTime(isoDate: string) {
  const minutes = Math.round((Date.now() - new Date(isoDate).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Hôm qua" : `${days} ngày`;
}

export default function NotificationsSheet({ model }: NotificationsSheetProps) {
  const { accountLoading, customerAccount, customerSession, flash, openAuthSheet, setShowNotifications, showNotifications } = model;
  if (!showNotifications) return null;
  const notifications = customerAccount?.notifications || [];
  const unread = notifications.filter((item) => !item.read_at).length;
  return (
    <div
      className={styles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) setShowNotifications(false);
      }}
    >
      <section className={`${styles.sheet} ${styles.noticeSheet}`} role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <div className={styles.sheetGrabber} />
        <div className={styles.sheetHeading}>
          <div>
            <small>THEO TÀI KHOẢN CỦA BẠN</small>
            <h2 id="notice-title">Thông báo</h2>
          </div>
          <button type="button" aria-label="Đóng" onClick={() => setShowNotifications(false)}>
            <X size={20} />
          </button>
        </div>

        {!customerSession ? (
          <div className={styles.noticeEmpty}>
            <BellOff size={30} />
            <strong>Đăng nhập để nhận thông báo</strong>
            <p>Thông báo về đơn hàng, phòng nhóm và hoa hồng được gửi theo tài khoản của bạn.</p>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                setShowNotifications(false);
                openAuthSheet("login");
              }}
            >
              <LogIn size={17} /> Đăng nhập
            </button>
          </div>
        ) : accountLoading && !notifications.length ? (
          <div className={styles.noticeEmpty}>
            <Bell size={30} />
            <strong>Đang tải thông báo…</strong>
          </div>
        ) : !notifications.length ? (
          <div className={styles.noticeEmpty}>
            <BellOff size={30} />
            <strong>Chưa có thông báo nào</strong>
            <p>Khi đơn của bạn đổi trạng thái, thông báo sẽ xuất hiện ở đây.</p>
          </div>
        ) : (
          <>
            <div className={styles.noticeSummary}>
              <span>{unread} chưa đọc</span>
            </div>
            <div className={styles.noticeList}>
              {notifications.map((notice) => (
                <button
                  type="button"
                  className={!notice.read_at ? styles.noticeUnread : ""}
                  key={notice.id}
                  onClick={() => {
                    if (notice.action_url) {
                      window.location.href = notice.action_url;
                      return;
                    }
                    flash(notice.title);
                  }}
                >
                  <span>
                    <Bell size={19} />
                  </span>
                  <div>
                    <strong>{notice.title}</strong>
                    <small>{notice.body}</small>
                    <em>{relativeTime(notice.created_at)}</em>
                  </div>
                  {!notice.read_at && <i />}
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
