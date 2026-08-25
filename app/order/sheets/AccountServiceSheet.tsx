import { ArrowRight, CheckCircle2, X } from "lucide-react";
import styles from "../customer.module.css";
import type { OrderController } from "../controller";

type AccountServiceSheetProps = { model: OrderController };

export default function AccountServiceSheet({ model }: AccountServiceSheetProps) {
  const { AccountServiceIcon, accountServiceDetail, flash, selectedAccountService, setPayment, setSelectedAccountService, setShowChat } = model;
  return (accountServiceDetail && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedAccountService(null);
          }}
        >
          <section className={`${styles.sheet} ${styles.accountServiceSheet}`} role="dialog" aria-modal="true" aria-labelledby="account-service-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div>
                <small>{accountServiceDetail.eyebrow}</small>
                <h2 id="account-service-title">{accountServiceDetail.title}</h2>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setSelectedAccountService(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.accountServiceIntro}>
              <span><AccountServiceIcon size={27} /></span>
              <p>{accountServiceDetail.description}</p>
            </div>
            <div className={styles.accountServiceList}>
              {accountServiceDetail.items.map((item) => (
                <article key={item.title}>
                  <span><CheckCircle2 size={18} /></span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.note}</small>
                  </div>
                </article>
              ))}
            </div>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                if (selectedAccountService === "payments") setPayment("qr");
                if (selectedAccountService === "support") {
                  setSelectedAccountService(null);
                  setShowChat(true);
                  return;
                }
                if (selectedAccountService === "privacy") {
                  setSelectedAccountService(null);
                  window.location.href = "/privacy";
                  return;
                }
                const success = accountServiceDetail.success;
                setSelectedAccountService(null);
                // Mục chỉ để đọc (bảo mật, quyền riêng tư) không có gì để báo lại.
                if (success) flash(success);
              }}
            >
              {accountServiceDetail.action} <ArrowRight size={18} />
            </button>
          </section>
        </div>
      ));
}
