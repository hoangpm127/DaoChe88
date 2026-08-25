import { ArrowRight, Copy, DollarSign, Gift, LogIn, TicketPercent } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { SectionTitle } from "../controller";
import type { OrderController } from "../controller";

type OffersTabProps = { model: OrderController };

/**
 * Tab Ưu đãi.
 *
 * Bản trước hiển thị "VÍ ƯU ĐÃI CỦA HÀ · 04 voucher đang dùng · đã tiết kiệm
 * 426.000đ" cùng 4 gói tháng và 4 chương trình quà tặng — không cái nào có bảng
 * dữ liệu hay API đứng sau, nút bấm chỉ hiện một dòng thông báo rồi thôi. Nếu
 * khách mang những ưu đãi đó ra quán thì không có bản ghi nào để đối chiếu.
 *
 * Nay tab này đọc bảng promotions thật qua GET /api/customers/me: mã nào đang
 * hiệu lực, còn lượt và khách chưa dùng hết số lần cho phép thì hiện ở đây.
 * Không có mã nào thì nói thẳng là chưa có.
 */
function promotionValueLabel(promotion: { promo_type: string; value: number }) {
  if (promotion.promo_type === "percent") return `-${promotion.value / 100}%`;
  if (promotion.promo_type === "free_ship") return "Miễn ship";
  return `-${money(promotion.value)}`;
}

export default function OffersTab({ model }: OffersTabProps) {
  const { accountLoading, customerAccount, customerSession, flash, goTo, openAuthSheet, setPromotionCode } = model;
  const promotions = customerAccount?.promotions || [];

  return (
    <section className={`${styles.tabPage} ${styles.offersPage}`}>
      <div className={styles.offerUnifiedHero}>
        <div className={styles.offersHero}>
          <span><Gift size={24} /></span>
          <div>
            <small>ƯU ĐÃI CỦA BẠN</small>
            <h1>{customerSession ? "Mã đang dùng được" : "Đăng nhập để xem ưu đãi"}</h1>
            <p>
              {!customerSession
                ? "Ưu đãi được cấp theo tài khoản."
                : promotions.length
                  ? `${promotions.length} mã còn hiệu lực`
                  : "Chưa có mã nào cho tài khoản này"}
            </p>
          </div>
          {customerSession && promotions.length > 0 && <b>{promotions.length}</b>}
        </div>
      </div>

      {!customerSession ? (
        <div className={styles.offersEmpty}>
          <TicketPercent size={30} />
          <strong>Ưu đãi gắn với tài khoản</strong>
          <p>Đăng nhập để xem mã giảm giá đang áp dụng cho bạn và dùng ngay khi đặt món.</p>
          <button className={styles.primaryButton} type="button" onClick={() => openAuthSheet("login")}>
            <LogIn size={17} /> Đăng nhập
          </button>
        </div>
      ) : accountLoading && !promotions.length ? (
        <div className={styles.offersEmpty}>
          <TicketPercent size={30} />
          <strong>Đang tải ưu đãi…</strong>
        </div>
      ) : !promotions.length ? (
        <div className={styles.offersEmpty}>
          <TicketPercent size={30} />
          <strong>Chưa có ưu đãi nào</strong>
          <p>Khi Tào Phớ 88 phát hành mã giảm giá áp dụng cho bạn, mã sẽ xuất hiện ở đây. Bạn cũng có thể nhập mã trực tiếp ở bước thanh toán.</p>
        </div>
      ) : (
        <>
          <SectionTitle title="Mã dùng được" />
          <div className={styles.promotionList}>
            {promotions.map((promotion) => (
              <article className={styles.promotionCard} key={promotion.code}>
                <span><TicketPercent size={21} /></span>
                <div>
                  <strong>{promotion.name}</strong>
                  <small>
                    {promotion.min_order_amount > 0 ? `Đơn từ ${money(promotion.min_order_amount)}` : "Không yêu cầu giá trị tối thiểu"}
                    {" · "}
                    Đến {new Date(promotion.ends_at).toLocaleDateString("vi-VN")}
                  </small>
                  <code>{promotion.code}</code>
                </div>
                <b>{promotionValueLabel(promotion)}</b>
                <button
                  type="button"
                  aria-label={`Dùng mã ${promotion.code}`}
                  onClick={() => {
                    setPromotionCode(promotion.code);
                    flash(`Đã chọn mã ${promotion.code}. Mã sẽ được áp ở bước thanh toán.`);
                  }}
                >
                  <Copy size={16} /> Dùng mã
                </button>
              </article>
            ))}
          </div>
        </>
      )}

      <article className={styles.offerAffiliateTeaser}>
        <DollarSign size={23} />
        <div>
          <small>AFFILIATE MINH BẠCH</small>
          <strong>Giới thiệu khách, nhận hoa hồng từ đơn thật</strong>
        </div>
        <button type="button" onClick={() => goTo("affiliate")}>Xem thu nhập <ArrowRight size={14} /></button>
      </article>
    </section>
  );
}
