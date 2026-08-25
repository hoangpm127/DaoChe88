import { ArrowRight, Check, ChevronRight, Clock3, Coffee, Home, LogIn, LucideIcon, MapPin, PackageCheck, ReceiptText, Search, ShieldCheck, Truck } from "lucide-react";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import { SectionTitle } from "../controller";
import type { OrderController } from "../controller";

type OrdersTabProps = { model: OrderController };

/** Nhãn tiếng Việt cho trạng thái đơn do máy chủ trả về. */
function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    new: "Đã tiếp nhận",
    accepted: "Đã xác nhận",
    preparing: "Đang làm món",
    ready: "Sẵn sàng",
    assigned: "Đã ghép shipper",
    picked_up: "Đã lấy món",
    delivering: "Đang giao",
    delivered: "Đã giao",
    delivery_failed: "Giao không thành công",
    cancelled: "Đã hủy",
  };
  return labels[status] || status;
}

export default function OrdersTab({ model }: OrdersTabProps) {
  const { accountLoading, activeOrder, customerAccount, customerSession, flash, goTo, location, openAuthSheet, setCart, setCartChoices } = model;
  return (
    <section className={styles.tabPage}>
      <div className={styles.simpleHeading}>
        <div>
          <p>THEO DÕI THEO THỜI GIAN THỰC</p>
          <h1>Đơn hàng của bạn</h1>
        </div>
        <button type="button" aria-label="Tìm đơn">
          <Search size={20} />
        </button>
      </div>
      {activeOrder ? (
        <article className={styles.activeOrder}>
          <div className={styles.activeOrderTop}>
            <span>{activeOrder.status === "preparing" ? "ĐANG LÀM MÓN" : activeOrder.status === "delivering" ? "ĐANG GIAO" : activeOrder.status === "completed" ? "ĐÃ GIAO" : activeOrder.status === "cancelled" ? "ĐÃ HỦY" : "ĐÃ XÁC NHẬN"}</span>
            <small>#{activeOrder.id}</small>
          </div>
          <h2>Đơn từ Tào Phớ 88 {activeOrder.point}</h2>
          <p>
            {activeOrder.lines.reduce((sum, line) => sum + line.quantity, 0)} món · {money(activeOrder.total)} · {activeOrder.payment === "qr" ? "thanh toán QR" : "tiền mặt"}
          </p>
          <div className={styles.orderTimeline}>
            {([
              [Check, activeOrder.status === "cancelled" ? "Đã hủy" : "Đã xác nhận", true],
              [Coffee, "Đang làm món", ["preparing", "delivering", "completed"].includes(activeOrder.status)],
              [Truck, "Đang giao", ["delivering", "completed"].includes(activeOrder.status)],
              [Home, "Đã nhận", activeOrder.status === "completed"],
            ] satisfies Array<[LucideIcon, string, boolean]>).map(([Icon, label, active], index) => (
              <div className={active ? styles.timelineActive : ""} key={label as string}>
                <span>
                  <Icon size={16} />
                </span>
                <small>{label as string}</small>
                {index < 3 && <i />}
              </div>
            ))}
          </div>
          {activeOrder.deliveryOtp && (
            <div className={styles.orderEta}>
              <ShieldCheck size={18} />
              <div>
                <span>OTP xác nhận nhận hàng</span>
                <strong>{activeOrder.deliveryOtp}</strong>
              </div>
              <small>Chỉ đọc cho shipper khi đã nhận món</small>
            </div>
          )}
          {activeOrder.shipperLocation && (
            <div className={styles.orderEta}>
              <MapPin size={18} />
              <div>
                <span>Vị trí shipper gần nhất</span>
                <strong>{(activeOrder.shipperLocation.latitudeE6 / 1_000_000).toFixed(5)}, {(activeOrder.shipperLocation.longitudeE6 / 1_000_000).toFixed(5)}</strong>
              </div>
              <a href={`https://www.google.com/maps?q=${activeOrder.shipperLocation.latitudeE6 / 1_000_000},${activeOrder.shipperLocation.longitudeE6 / 1_000_000}`} target="_blank" rel="noreferrer">Mở bản đồ</a>
            </div>
          )}
          <div className={styles.orderEta}>
            <Clock3 size={18} />
            <div>
              <span>Dự kiến {activeOrder.fulfillment === "pickup" ? "sẵn sàng" : "giao"}</span>
              <strong>{activeOrder.customer.slot === "Sớm nhất có thể" ? location.eta : activeOrder.customer.slot}</strong>
            </div>
            <button type="button" onClick={() => flash(`Đã mở hỗ trợ cho đơn #${activeOrder.id}.`)}>
              Hỗ trợ
            </button>
          </div>
          <div className={styles.orderActions}>
            <button
              type="button"
              disabled
            >
              {activeOrder.status === "completed" ? "Đơn đã hoàn tất" : activeOrder.status === "cancelled" ? "Đơn đã được hủy" : "Tự động cập nhật trạng thái"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCart(Object.fromEntries(activeOrder.lines.map((line) => [line.id, line.quantity])));
                setCartChoices(Object.fromEntries(activeOrder.lines.flatMap((line) => line.choice ? [[line.id, line.choice]] : [])));
                goTo("home");
                flash("Đã thêm lại các món của đơn trước.");
              }}
            >
              Đặt lại
            </button>
          </div>
        </article>
      ) : (
        <div className={styles.emptyOrder}>
          <span>
            <ReceiptText size={30} />
          </span>
          <h2>Chưa có đơn đang giao</h2>
          <p>Khi bạn đặt món, tiến độ từ bếp tới giao hàng sẽ xuất hiện tại đây.</p>
          <button className={styles.primaryButton} type="button" onClick={() => goTo("home")}>
            Khám phá thực đơn <ArrowRight size={17} />
          </button>
        </div>
      )}
      <SectionTitle title="Đơn gần đây" />
      {/*
        Lịch sử đơn đọc từ GET /api/customers/me — nguồn duy nhất đúng, vì một
        khách có thể đặt trên nhiều thiết bị. Trước đây tab này chỉ biết đúng một
        đơn lưu trong localStorage của chính máy đang mở.
      */}
      <div className={styles.historyList}>
        {!customerSession ? (
          <button type="button" onClick={() => openAuthSheet("login")}>
            <span><LogIn size={20} /></span>
            <div>
              <small>Lịch sử đơn theo tài khoản</small>
              <strong>Đăng nhập để xem tất cả đơn đã đặt</strong>
            </div>
            <ChevronRight size={15} />
          </button>
        ) : accountLoading && !(customerAccount?.orders.length) ? (
          <p>Đang tải lịch sử đơn…</p>
        ) : !(customerAccount?.orders.length) ? (
          <p>Chưa có đơn nào trong tài khoản này.</p>
        ) : (
          customerAccount!.orders.map((order) => (
            <button type="button" key={order.order_code} onClick={() => flash(`Đơn ${order.order_code} · ${orderStatusLabel(order.order_status)}`)}>
              <span>
                <PackageCheck size={20} />
              </span>
              <div>
                <small>{new Date(order.created_at).toLocaleDateString("vi-VN")} · {orderStatusLabel(order.order_status)}</small>
                <strong>{order.order_code}</strong>
              </div>
              <b>{money(order.total_amount)}</b>
              <ChevronRight size={15} />
            </button>
          ))
        )}
      </div>
    </section>
  );
}
