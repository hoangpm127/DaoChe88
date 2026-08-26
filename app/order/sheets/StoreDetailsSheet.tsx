import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Navigation, ShieldCheck, Store } from "lucide-react";
import styles from "../customer.module.css";
import { storeServiceIcons } from "../data/content";
import type { OrderController } from "../controller";

type StoreDetailsSheetProps = { model: OrderController };

export default function StoreDetailsSheet({ model }: StoreDetailsSheetProps) {
  const { chooseServicePoint, flash, goTo, selectedStore, setSelectedStore } = model;
  return (selectedStore && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedStore(null);
          }}
        >
          <section className={`${styles.sheet} ${styles.storeSheet}`} role="dialog" aria-modal="true" aria-labelledby="store-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.storeSheetHero}>
              <div className={styles.mapRoads} />
              <span>
                <Store size={29} />
              </span>
              <button type="button" aria-label="Quay lại" onClick={() => setSelectedStore(null)}>
                <ArrowLeft size={20} />
              </button>
            </div>
            <div className={styles.storeSheetBody}>
              <div className={styles.storeSheetTitle}>
                <div>
                  <small>{selectedStore.kind}</small>
                  <h2 id="store-title">{selectedStore.name}</h2>
                  <p>{selectedStore.address}</p>
                </div>
                <b className={selectedStore.open ? styles.storeOpen : styles.storeClosed}>{selectedStore.open ? "Đang mở" : "Đã đóng"}</b>
              </div>
              <div className={styles.storeStats}>
                <span>
                  <strong><Navigation size={14} /> {selectedStore.distance === null ? "Chưa xác định" : `${selectedStore.distance.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`}</strong>
                  <small>từ bạn</small>
                </span>
                <span>
                  <strong><Clock3 size={14} /> {selectedStore.hours}</strong>
                  <small>giờ phục vụ</small>
                </span>
              </div>
              <div className={styles.storeServices}>
                <strong>Dịch vụ tại điểm bán</strong>
                <div>
                  {selectedStore.services.map((service) => {
                    const ServiceIcon = storeServiceIcons[service] || CheckCircle2;
                    return <span key={service}><ServiceIcon size={15} /> {service}</span>;
                  })}
                </div>
              </div>
              <div className={styles.storeAssurance}>
                <ShieldCheck size={19} />
                <p>
                  <strong>Điểm bán đã xác minh</strong>
                  <small>Món, nguyên liệu và giá bán tuân theo tiêu chuẩn Đảo Chè.</small>
                </p>
              </div>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={!selectedStore.open}
                onClick={() => {
                  if (!chooseServicePoint(selectedStore.id)) return;
                  setSelectedStore(null);
                  goTo("home");
                  flash(`Đang hiển thị thực đơn từ ${selectedStore.name}. Đơn của bạn sẽ vào điểm này.`);
                }}
              >
                {selectedStore.open ? `Đặt đồ từ đây · ${selectedStore.eta}` : selectedStore.closedReason || "Điểm bán đang đóng"} <ArrowRight size={18} />
              </button>
            </div>
          </section>
        </div>
      ));
}
