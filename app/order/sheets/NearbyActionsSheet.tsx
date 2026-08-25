import { Bike, Building2, Coffee, ShoppingBag, Store, UserPlus, UsersRound, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type NearbyActionsSheetProps = { model: OrderController };

export default function NearbyActionsSheet({ model }: NearbyActionsSheetProps) {
  const { dailyActionHubVerse, openAffiliateApplication, openGroupJourney, openPartnerApplication, openStorePreorderJourney, openTakeawayMenu, setShowNearbyActions, showNearbyActions } = model;
  return (showNearbyActions && (
        <div className={`${styles.backdrop} ${styles.actionHubBackdrop}`} onClick={(event) => event.target === event.currentTarget && setShowNearbyActions(false)}>
          <section className={styles.actionHubModal} role="dialog" aria-modal="true" aria-labelledby="nearby-action-title">
            <div className={styles.actionHubHeading}>
              <div>
                <small>MỘT CHẠM · ĐÚNG HÀNH TRÌNH</small>
                <h2 id="nearby-action-title">Bạn muốn bắt đầu thế nào?</h2>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setShowNearbyActions(false)}><X size={20} /></button>
            </div>
            <div className={styles.actionHubOrderPanel}>
              <div className={styles.actionHubSectionTitle}>
                <span><ShoppingBag size={17} /></span>
                <strong>ĐẶT MÓN</strong>
              </div>
              <div className={styles.actionHubOrderChoices}>
                <button type="button" onClick={openTakeawayMenu}>
                  <span><Bike size={19} /></span><strong>Mang về</strong><small>Giao tận nơi</small>
                </button>
                <button type="button" onClick={openGroupJourney}>
                  <span><UsersRound size={19} /></span><strong>Đặt nhóm</strong><small>Mỗi người tự chọn</small>
                </button>
                <button type="button" onClick={openStorePreorderJourney}>
                  <span><Coffee size={19} /></span><strong>Tại quán</strong><small>Ăn hoặc tự lấy</small>
                </button>
              </div>
            </div>

            <div className={styles.actionHubDivider}><span>ĐỒNG HÀNH CÙNG ĐẢO CHÈ</span></div>
            <div className={styles.actionHubBusinessGrid}>
              <button className={styles.actionHubAffiliate} type="button" onClick={() => { setShowNearbyActions(false); openAffiliateApplication(); }}>
                <span><UserPlus size={21} /></span>
                <div><strong>Affiliate</strong><small>Thu nhập 6–10%</small></div>
              </button>
              <button className={styles.actionHubDistributor} type="button" onClick={() => { setShowNearbyActions(false); openPartnerApplication("Có điểm bán sẵn"); }}>
                <span><Store size={21} /></span>
                <div><strong>Phân phối</strong><small>Có cửa hàng sẵn</small></div>
              </button>
              <button className={styles.actionHubNewStore} type="button" onClick={() => { setShowNearbyActions(false); openPartnerApplication("Sẵn sàng đầu tư"); }}>
                <span><Building2 size={21} /></span>
                <div><strong>Mở điểm bán</strong><small>Đầu tư điểm mới</small></div>
              </button>
            </div>
            <blockquote className={styles.actionHubVerse}>
              {dailyActionHubVerse.map((line) => <span key={line}>{line}</span>)}
              <strong>Đảo Chè — “Mang vị quê hương mời bạn thưởng mỗi ngày”</strong>
            </blockquote>
          </section>
        </div>
      ));
}
