import { CalendarDays, ChevronRight, MapPin, ReceiptText, ShieldCheck, X } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import type { OrderController } from "../controller";

type RevenueDetailsSheetProps = { model: OrderController };

export default function RevenueDetailsSheet({ model }: RevenueDetailsSheetProps) {
  const { flash, selectedRevenueSource, setSelectedRevenueSource } = model;
  return (selectedRevenueSource && (
        <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setSelectedRevenueSource(null)}>
          <section className={`${styles.sheet} ${styles.revenueDetailSheet}`} role="dialog" aria-modal="true" aria-labelledby="revenue-detail-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div><small>CHI TIẾT NGUỒN DOANH THU</small><h2 id="revenue-detail-title">{selectedRevenueSource.title}</h2></div>
              <button type="button" aria-label="Đóng" onClick={() => setSelectedRevenueSource(null)}><X size={20} /></button>
            </div>
            <div className={styles.revenueSourceMeta}><MapPin size={16} /><span>{selectedRevenueSource.location}</span><em>Đã xác minh</em></div>
            <div className={styles.revenueDetailTotals}>
              <div><small>Doanh số</small><strong>{money(selectedRevenueSource.sales)}</strong></div>
              <div><small>Hoa hồng</small><strong>{money(selectedRevenueSource.commission)}</strong></div>
              <div><small>Đơn · ly</small><strong>{selectedRevenueSource.orders} · {selectedRevenueSource.cups}</strong></div>
            </div>
            <div className={styles.revenueDetailSection}>
              <div className={styles.revenueDetailHeading}><h3>Theo từng ngày</h3><small>Chạm bill bên dưới để đối chiếu</small></div>
              <div className={styles.revenueDailyList}>
                {selectedRevenueSource.daily.map((day) => (
                  <div key={day.date}><span><CalendarDays size={16} /></span><div><strong>{day.date}</strong><small>{day.orders} đơn · {money(day.sales)}</small></div><b>+{money(day.commission)}</b></div>
                ))}
              </div>
            </div>
            <div className={styles.revenueDetailSection}>
              <div className={styles.revenueDetailHeading}><h3>Từng bill & tọa độ giao</h3><small>{selectedRevenueSource.bills.length} bill gần nhất</small></div>
              <div className={styles.revenueBillList}>
                {selectedRevenueSource.bills.map((bill) => (
                  <button type="button" key={bill.id} onClick={() => flash(`Đã đối chiếu ${bill.id}: tọa độ ${bill.coordinates}.`)}>
                    <span><ReceiptText size={18} /></span>
                    <div><strong>{bill.id} · {bill.time}</strong><small>{bill.customer}</small><em><MapPin size={11} /> {bill.coordinates}</em></div>
                    <aside><b>+{money(bill.commission)}</b><small>{money(bill.sales)}</small></aside><ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.revenueProof}><ShieldCheck size={17} /><span>Số liệu chỉ ghi nhận sau khi đơn đã giao. Hoàn/huỷ được cập nhật tự động trong kỳ đối soát.</span></div>
          </section>
        </div>
      ));
}
