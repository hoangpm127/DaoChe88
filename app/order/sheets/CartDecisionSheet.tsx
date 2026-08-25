import { ChevronRight, Plus, ReceiptText, ShoppingBag, X } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import type { OrderController } from "../controller";

type CartDecisionSheetProps = { model: OrderController };

export default function CartDecisionSheet({ model }: CartDecisionSheetProps) {
  const { cartCount, cartPreview, cartTotal, continueShopping, orderNow, setShowCartDecision, showCartDecision } = model;
  return (showCartDecision && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowCartDecision(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.cartDecisionSheet}`} role="dialog" aria-modal="true" aria-labelledby="cart-decision-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>GIỎ HIỆN TẠI · {cartCount} MÓN</small>
                <h2 id="cart-decision-title">Bạn muốn làm gì tiếp theo?</h2>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setShowCartDecision(false)}>
                <X size={20} />
              </button>
            </div>

            <div className={styles.cartDecisionSummary}>
              <span aria-hidden="true"><ReceiptText size={22} /></span>
              <div>
                <strong>{cartPreview}</strong>
                <small>{cartCount} món · tự động giữ nguyên trong giỏ</small>
              </div>
              <b>{money(cartTotal)}</b>
            </div>

            <div className={styles.cartDecisionActions}>
              <button type="button" onClick={continueShopping}>
                <span><Plus size={22} /></span>
                <div>
                  <small>CHỌN TIẾP</small>
                  <strong>Chọn thêm món</strong>
                  <p>Mở toàn bộ thực đơn, món trong giỏ vẫn được giữ nguyên.</p>
                </div>
                <ChevronRight size={18} />
              </button>
              <button type="button" onClick={orderNow}>
                <span><ShoppingBag size={22} /></span>
                <div>
                  <small>HOÀN TẤT ĐƠN</small>
                  <strong>Đặt ngay</strong>
                  <p>Kiểm tra món, cách nhận hàng và thanh toán trước khi xác nhận.</p>
                </div>
                <ChevronRight size={18} />
              </button>
            </div>
          </section>
        </div>
      ));
}
