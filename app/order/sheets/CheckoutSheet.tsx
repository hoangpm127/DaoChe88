import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Minus, Navigation, Plus, QrCode, ShieldCheck, Store, Truck, X } from "lucide-react";
import styles from "../customer.module.css";
import { paymentOptions } from "../data/content";
import { money } from "../lib/order-utils";
import { ProductPhoto, Stepper } from "../controller";
import type { OrderController } from "../controller";

type CheckoutSheetProps = { model: OrderController };

export default function CheckoutSheet({ model }: CheckoutSheetProps) {
  const { cart, cartChoices, cartCount, cartLines, cartTotal, checkoutStep, checkoutTotal, continueCheckout, customer, deliveryFee, deliveryQuote, deliveryQuoteError, deliveryQuoteLoading, fulfillment, location, payment, placeOrder, placingOrder, privacyConsent, promotionCode, setCheckoutStep, setCustomer, setFulfillment, setPayment, setPrivacyConsent, setPromotionCode, setShowCart, setShowLocation, showCart, updateCart } = model;
  return (showCart && (
        <div
          className={styles.backdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowCart(false);
          }}
        >
          <section className={`${styles.sheet} ${styles.checkoutSheet}`} role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <div className={styles.sheetGrabber} />
            <div className={styles.sheetHeading}>
              <div className={styles.headingWithBack}>
                {checkoutStep !== "cart" && (
                  <button type="button" aria-label="Quay lại" onClick={() => setCheckoutStep(checkoutStep === "payment" ? "details" : "cart")}>
                    <ArrowLeft size={19} />
                  </button>
                )}
                <div>
                  <small>ĐIỂM {location.name.toLocaleUpperCase("vi")}</small>
                  <h2 id="cart-title">{checkoutStep === "cart" ? "Giỏ hàng của bạn" : checkoutStep === "details" ? "Thông tin giao nhận" : "Chọn thanh toán"}</h2>
                </div>
              </div>
              <button type="button" aria-label="Đóng" onClick={() => setShowCart(false)}>
                <X size={20} />
              </button>
            </div>
            <Stepper step={checkoutStep} />
            {checkoutStep === "cart" && (
              <>
                <div className={styles.cartList}>
                  {cartLines.map((product) => {
                    const choice = cartChoices[product.id];
                    const toppingPrice = choice ? product.toppings.find((item) => item.name === choice.topping)?.price || 0 : 0;
                    return (
                      <article key={product.id}>
                        <ProductPhoto index={product.image} imageUrl={product.imageUrl} />
                        <div>
                          <strong>{product.name}</strong>
                          <small>{choice ? `${choice.sweetness} · ${choice.temperature} · ${choice.topping}` : product.note}</small>
                          <b>{money(product.price + toppingPrice)}</b>
                        </div>
                        <span className={styles.quantityControl}>
                          <button type="button" onClick={() => updateCart(product.id, -1)} aria-label="Giảm">
                            <Minus size={14} />
                          </button>
                          <b>{cart[product.id]}</b>
                          <button type="button" onClick={() => updateCart(product.id, 1)} aria-label="Tăng">
                            <Plus size={14} />
                          </button>
                        </span>
                      </article>
                    );
                  })}
                </div>
                <div className={styles.deliveryChoice}>
                  <button className={fulfillment === "delivery" ? styles.deliveryActive : ""} type="button" onClick={() => setFulfillment("delivery")}>
                    <Truck size={18} />
                    <span>
                      <strong>Giao tận nơi</strong>
                      <small>{location.eta}</small>
                    </span>
                    {fulfillment === "delivery" && <Check size={15} />}
                  </button>
                  <button className={fulfillment === "pickup" ? styles.deliveryActive : ""} type="button" onClick={() => setFulfillment("pickup")}>
                    <Store size={18} />
                    <span>
                      <strong>Tự đến lấy</strong>
                      <small>Không phí giao</small>
                    </span>
                    {fulfillment === "pickup" && <Check size={15} />}
                  </button>
                </div>
                <div className={styles.cartSummary}>
                  <span>Tạm tính</span>
                  <strong>{money(cartTotal)}</strong>
                  <span>Phí giao đã khóa</span>
                  <strong>{fulfillment === "pickup" ? "Miễn phí" : deliveryQuoteLoading ? "Đang tính…" : deliveryQuote ? (deliveryFee ? money(deliveryFee) : "Miễn phí") : "Chưa có"}</strong>
                  {fulfillment === "delivery" && deliveryQuote?.lalamove && <span>So sánh nội bộ / Lalamove</span>}
                  {fulfillment === "delivery" && deliveryQuote?.lalamove && <strong>{money(deliveryQuote.internal.fee)} / {money(deliveryQuote.lalamove.fee)}</strong>}
                  {fulfillment === "delivery" && deliveryQuote && <span>Khoảng cách server</span>}
                  {fulfillment === "delivery" && deliveryQuote && <strong>{(deliveryQuote.distanceMeters / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} km</strong>}
                  <b>Tổng cộng</b>
                  <b>{money(checkoutTotal)}</b>
                </div>
                {fulfillment === "delivery" && deliveryQuoteError && <p role="alert">{deliveryQuoteError}</p>}
                <button className={styles.primaryButton} type="button" disabled={fulfillment === "delivery" && (!deliveryQuote || deliveryQuoteLoading)} onClick={continueCheckout}>
                  Tiếp tục giao nhận <ArrowRight size={18} />
                </button>
              </>
            )}
            {checkoutStep === "details" && (
              <div className={styles.checkoutForm}>
                <div className={styles.pointCard}>
                  <span>
                    <Navigation size={19} />
                  </span>
                  <div>
                    <small>ĐỊA CHỈ GIAO · {location.coordinates}</small>
                    <strong>{location.office}</strong>
                    <p>{location.address}</p>
                    <em>
                      {location.servicePoint} · {location.distance} · {location.eta}
                    </em>
                  </div>
                  <button type="button" onClick={() => setShowLocation(true)}>
                    Đổi
                  </button>
                </div>
                <label>
                  <span>Tên người nhận *</span>
                  <input value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} placeholder="Tên của bạn" />
                </label>
                <label>
                  <span>Số điện thoại *</span>
                  <input inputMode="tel" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} placeholder="VD: 0912 345 678" />
                </label>
                {fulfillment === "delivery" && (
                  <label>
                    <span>Địa chỉ giao *</span>
                    <textarea
                      value={customer.address}
                      onChange={(event) =>
                        setCustomer({
                          ...customer,
                          address: event.target.value,
                        })
                      }
                      placeholder="Tòa nhà, số tầng, tên đường..."
                    />
                  </label>
                )}
                <label>
                  <span>Thời gian nhận</span>
                  <select value={customer.slot} onChange={(event) => setCustomer({ ...customer, slot: event.target.value })}>
                    <option>Sớm nhất có thể</option>
                    <option>11:30 – 11:45</option>
                    <option>14:15 – 14:30</option>
                    <option>15:30 – 15:45</option>
                  </select>
                  <ChevronDown size={16} />
                </label>
                <label>
                  <span>Ghi chú cho bếp / shipper</span>
                  <textarea value={customer.note} onChange={(event) => setCustomer({ ...customer, note: event.target.value })} placeholder="VD: Ít ngọt, gọi khi tới sảnh..." />
                </label>
                <button className={styles.primaryButton} type="button" onClick={continueCheckout}>
                  Tiếp tục thanh toán <ArrowRight size={18} />
                </button>
              </div>
            )}
            {checkoutStep === "payment" && (
              <div className={styles.paymentStep}>
                <div className={styles.paymentList}>
                  {paymentOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button type="button" className={payment === option.id ? styles.paymentActive : ""} key={option.id} onClick={() => setPayment(option.id)}>
                        <span>
                          <Icon size={20} />
                        </span>
                        <div>
                          <strong>{option.name}</strong>
                          <small>{option.note}</small>
                        </div>
                        {payment === option.id && <CheckCircle2 size={19} />}
                      </button>
                    );
                  })}
                </div>
                {payment === "qr" && (
                  <div className={styles.qrNotice}>
                    <QrCode size={25} />
                    <p>
                      <strong>Mã QR sẽ hiện sau khi xác nhận</strong>
                      <small>Đơn chỉ vào bếp khi giao dịch được ghi nhận.</small>
                    </p>
                  </div>
                )}
                {/*
                  Ô nhập mã giảm giá. Bộ máy khuyến mãi đã có từ M11 (order.create
                  nhận promotionCode, tự kiểm điều kiện và tự tính mức giảm phía
                  máy chủ, rồi ghi promotion_redemptions) nhưng chưa từng có ô nào
                  để khách nhập mã. Ở đây chỉ gửi mã đi — không tính tiền phía
                  trình duyệt, nên không thể tự bịa ra mức giảm.
                */}
                <label className={styles.promotionField}>
                  <span>Mã giảm giá</span>
                  <input
                    value={promotionCode}
                    onChange={(event) => setPromotionCode(event.target.value.toLocaleUpperCase("en-US"))}
                    placeholder="Nhập mã nếu bạn có"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={40}
                  />
                  <small>Mức giảm do máy chủ tính và hiện trên đơn sau khi xác nhận.</small>
                </label>
                <div className={styles.finalReview}>
                  <div>
                    <span>
                      {cartCount} món · {fulfillment === "delivery" ? "Giao tận nơi" : "Tự đến lấy"}
                    </span>
                    <button type="button" onClick={() => setCheckoutStep("cart")}>
                      Sửa giỏ
                    </button>
                  </div>
                  <strong>{money(checkoutTotal)}</strong>
                  <small>{fulfillment === "delivery" ? customer.address : `Nhận tại Đảo Chè ${location.name}`}</small>
                </div>
                <div className={styles.checkoutAssurance}>
                  <ShieldCheck size={18} />
                  <p>Thông tin đơn hàng được dùng để chuẩn bị và giao món. Bạn có thể yêu cầu hỗ trợ ngay trong mục Đơn hàng.</p>
                </div>
                <label className={styles.privacyConsent}>
                  <input type="checkbox" checked={privacyConsent} onChange={(event) => setPrivacyConsent(event.target.checked)} />
                  <span>Tôi đồng ý với <a href="/terms" target="_blank">Điều khoản sử dụng</a> và <a href="/privacy" target="_blank">Chính sách quyền riêng tư</a>.</span>
                </label>
                <button className={styles.primaryButton} type="button" disabled={placingOrder || !privacyConsent} onClick={() => void placeOrder()}>
                  {placingOrder ? "Đang tạo đơn…" : `Xác nhận đặt đơn · ${money(checkoutTotal)}`} {!placingOrder && <ArrowRight size={18} />}
                </button>
              </div>
            )}
          </section>
        </div>
      ));
}
