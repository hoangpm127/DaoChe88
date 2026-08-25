import { ArrowRight, CheckCircle2, ChevronRight, Clock3, Copy, QrCode, UserPlus } from "lucide-react";
import Image from "next/image";
import styles from "../customer.module.css";
import { money } from "../lib/order-utils";
import type { OrderController } from "../controller";

type OrderSuccessSheetProps = { model: OrderController };

export default function OrderSuccessSheet({ model }: OrderSuccessSheetProps) {
  const { activeOrder, flash, fulfillment, goTo, location, openAffiliateApplication, placedOrderId, setPlacedOrderId } = model;
  return (placedOrderId && (
        <div className={styles.successOverlay}>
          <div className={styles.successCard}>
            <span>
              {activeOrder?.paymentDetails && !["paid", "overpaid"].includes(activeOrder.paymentStatus) ? <QrCode size={38} /> : <CheckCircle2 size={38} />}
            </span>
            <small>{activeOrder?.paymentDetails && !["paid", "overpaid"].includes(activeOrder.paymentStatus) ? "CHỜ THANH TOÁN VIETQR" : "ĐẶT ĐƠN THÀNH CÔNG"}</small>
            <h2>{activeOrder?.paymentDetails && !["paid", "overpaid"].includes(activeOrder.paymentStatus) ? "Quét mã để xác nhận đơn" : "Bếp đang nhận đơn của bạn"}</h2>
            <p>
              Mã đơn <strong>#{placedOrderId}</strong> · dự kiến {fulfillment === "delivery" ? `giao trong ${location.eta}` : "sẵn sàng trong 15–20 phút"}.
            </p>
            {activeOrder?.paymentDetails && (
              <div className={styles.successQrPanel}>
                <Image className={styles.successQrImage} src={activeOrder.paymentDetails.qrUrl} alt={`VietQR thanh toán ${activeOrder.paymentDetails.paymentCode}`} width={300} height={300} unoptimized />
                <div className={styles.successQrFacts}>
                  <span><small>Số tiền</small><strong>{money(activeOrder.paymentDetails.amount)}</strong></span>
                  <span><small>Ngân hàng</small><strong>{activeOrder.paymentDetails.bankCode} · {activeOrder.paymentDetails.bankAccount}</strong></span>
                  <span><small>Nội dung</small><strong>{activeOrder.paymentDetails.paymentCode}</strong></span>
                </div>
                <button type="button" onClick={() => void navigator.clipboard.writeText(activeOrder.paymentDetails?.paymentCode || "").then(() => flash("Đã sao chép nội dung chuyển khoản."))}>
                  <Copy size={15} /> Sao chép nội dung
                </button>
                <div className={styles.successPayment} data-status={activeOrder.paymentStatus}>
                  {activeOrder.paymentStatus === "expired" ? <Clock3 size={23} /> : ["paid", "overpaid"].includes(activeOrder.paymentStatus) ? <CheckCircle2 size={23} /> : <QrCode size={23} />}
                  <div>
                    <strong>{activeOrder.paymentStatus === "expired" ? "Mã thanh toán đã hết hạn" : ["paid", "overpaid"].includes(activeOrder.paymentStatus) ? "SePay đã xác nhận tiền vào" : activeOrder.paymentStatus === "partially_paid" ? "Đã nhận một phần, vui lòng chuyển đủ" : "Đang chờ SePay xác nhận"}</strong>
                    <small>{activeOrder.paymentStatus === "partially_paid" ? `Đã nhận ${money(activeOrder.paymentDetails.receivedAmount)} / ${money(activeOrder.paymentDetails.amount)}` : ["paid", "overpaid"].includes(activeOrder.paymentStatus) ? "Đơn đã được chuyển vào hàng đợi của bếp." : "Hệ thống tự kiểm tra mỗi 3 giây."}</small>
                  </div>
                </div>
              </div>
            )}
            <button
              className={styles.successAffiliateInvite}
              type="button"
              onClick={() => {
                setPlacedOrderId(null);
                openAffiliateApplication();
              }}
            >
              <span>
                <UserPlus size={21} />
              </span>
              <div>
                <small>SAU ĐƠN ĐẦU TIÊN</small>
                <strong>Giới thiệu khách, nhận 6–10%</strong>
                <p>Thu nhập thêm từ đơn quay lại của cộng đồng bạn kết nối.</p>
              </div>
              <ChevronRight size={17} />
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                setPlacedOrderId(null);
                goTo("orders");
              }}
            >
              Theo dõi đơn hàng <ArrowRight size={18} />
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setPlacedOrderId(null);
                goTo("home");
              }}
            >
              Về trang chủ
            </button>
          </div>
        </div>
      ));
}
