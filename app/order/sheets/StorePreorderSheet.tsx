import { ArrowRight, Check, ChevronDown, Clock3, ShoppingBag, Sparkles, Utensils, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type StorePreorderSheetProps = { model: OrderController };

export default function StorePreorderSheet({ model }: StorePreorderSheetProps) {
  const { confirmStorePreorder, setShowStorePreorder, setStorePreorderMode, setStorePreorderPartySize, setStorePreorderStoreId, setStorePreorderTableLabel, setStorePreorderTime, showStorePreorder, storePoints, storePreorderMode, storePreorderPartySize, storePreorderStoreId, storePreorderTableLabel, storePreorderTime } = model;
  return (showStorePreorder && (
        <div className={`${styles.backdrop} ${styles.actionHubBackdrop}`} onClick={(event) => event.target === event.currentTarget && setShowStorePreorder(false)}>
          <section className={`${styles.actionHubModal} ${styles.storePreorderModal}`} role="dialog" aria-modal="true" aria-labelledby="store-preorder-title">
            <div className={styles.actionHubHeading}>
              <div><small>ĐẶT TRƯỚC · KHÔNG CẦN CHỜ</small><h2 id="store-preorder-title">Hẹn món tại cửa hàng</h2><p>Chọn cách nhận, địa điểm và giờ bạn dự kiến tới.</p></div>
              <button type="button" aria-label="Đóng" onClick={() => setShowStorePreorder(false)}><X size={20} /></button>
            </div>
            <form className={styles.storePreorderForm} onSubmit={confirmStorePreorder}>
              <div className={styles.storePreorderModes} aria-label="Cách dùng món">
                <button className={storePreorderMode === "dine-in" ? styles.storePreorderModeActive : ""} type="button" onClick={() => setStorePreorderMode("dine-in")}>
                  <Utensils size={22} /><span><strong>Qua ngồi ăn</strong><small>Giữ giờ và chuẩn bị bàn</small></span><Check size={17} />
                </button>
                <button className={storePreorderMode === "pickup" ? styles.storePreorderModeActive : ""} type="button" onClick={() => setStorePreorderMode("pickup")}>
                  <ShoppingBag size={22} /><span><strong>Tự lấy mang về</strong><small>Nhận nhanh tại quầy</small></span><Check size={17} />
                </button>
              </div>
              <label>
                <span>Cửa hàng bạn muốn tới</span>
                <select value={storePreorderStoreId} onChange={(event) => setStorePreorderStoreId(event.target.value)}>
                  {storePoints.filter((store) => store.open).slice(0, 8).map((store) => <option value={store.id} key={store.id}>{store.name}{store.distance === null ? "" : ` · ${store.distance.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km`}</option>)}
                </select>
                <ChevronDown size={16} />
              </label>
              <div className={styles.storePreorderRow}>
                <label><span>Giờ dự kiến</span><input type="time" value={storePreorderTime} onChange={(event) => setStorePreorderTime(event.target.value)} /></label>
                {storePreorderMode === "dine-in" ? (
                  <><label><span>Số người</span><select value={storePreorderPartySize} onChange={(event) => setStorePreorderPartySize(event.target.value)}><option>1 người</option><option>2 người</option><option>3–4 người</option><option>5–8 người</option><option>Trên 8 người</option></select><ChevronDown size={16} /></label><label><span>Số bàn</span><input required value={storePreorderTableLabel} onChange={(event) => setStorePreorderTableLabel(event.target.value)} placeholder="Ví dụ: Bàn 06" /></label></>
                ) : (
                  <div className={styles.storePreorderPromise}><Clock3 size={18} /><span><strong>Nhận trong 2 phút</strong><small>Khi món đã sẵn sàng</small></span></div>
                )}
              </div>
              <div className={styles.storePreorderSummary}><Sparkles size={17} /><p>AI giữ cấu hình cửa hàng và giờ nhận trong bill; sau khi chọn món bạn chỉ cần xác nhận.</p></div>
              <button className={styles.primaryButton} type="submit">Tiếp tục chọn món <ArrowRight size={18} /></button>
            </form>
          </section>
        </div>
      ));
}
