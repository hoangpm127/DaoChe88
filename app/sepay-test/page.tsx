"use client";

import Image from "next/image";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import styles from "./sepay-test.module.css";

type PaymentStatus = "pending" | "partially_paid" | "paid" | "overpaid" | "expired" | "failed";

type Payment = {
  provider: "sepay";
  orderId: string;
  orderCode: string;
  paymentCode: string;
  bankCode: string;
  bankAccount: string;
  amount: number;
  receivedAmount: number;
  currency: "VND";
  status: PaymentStatus;
  expiresAt: string;
  paidAt: string | null;
  qrUrl: string;
};

type ApiError = { error?: string; code?: string };

const terminalStatuses = new Set<PaymentStatus>(["paid", "overpaid", "expired", "failed"]);

function money(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
}

function timeLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function statusCopy(payment: Payment) {
  if (payment.status === "paid") return { eyebrow: "WEBHOOK ĐÃ KHỚP", title: "Đã nhận đủ 2.000đ", note: "SePay đã gọi webhook và backend đã tự động xác nhận giao dịch.", tone: "success" };
  if (payment.status === "overpaid") return { eyebrow: "WEBHOOK ĐÃ KHỚP", title: `Đã nhận ${money(payment.receivedAmount)}`, note: `Giao dịch đang thừa ${money(payment.receivedAmount - payment.amount)} so với số tiền kiểm thử.`, tone: "success" };
  if (payment.status === "partially_paid") return { eyebrow: "ĐÃ NHẬN MỘT PHẦN", title: `${money(payment.receivedAmount)} / ${money(payment.amount)}`, note: "Backend đã nhận webhook nhưng số tiền chưa đủ để hoàn tất.", tone: "partial" };
  if (payment.status === "expired") return { eyebrow: "MÃ ĐÃ HẾT HẠN", title: "Tạo mã kiểm thử mới", note: "Mã QR chỉ có hiệu lực trong cửa sổ kiểm thử 15 phút.", tone: "danger" };
  if (payment.status === "failed") return { eyebrow: "CẦN KIỂM TRA", title: "Đối soát chưa thành công", note: "Tạo mã mới hoặc kiểm tra lịch sử webhook trên SePay.", tone: "danger" };
  return { eyebrow: "ĐANG CHỜ CHUYỂN KHOẢN", title: "Chờ SePay gửi webhook", note: "Trang tự kiểm tra backend mỗi 2 giây; bạn không cần tải lại.", tone: "pending" };
}

export default function SePayTestPage() {
  const [paymentCode, setPaymentCode] = useState(() => typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("code")?.trim().toUpperCase() || "");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const loadPayment = useCallback(async (code: string, quiet = false) => {
    if (!code) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/payments/sepay?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { payment?: Payment } & ApiError;
      if (!response.ok || !payload.payment) throw new Error(payload.error || "Không đọc được trạng thái thanh toán.");
      setPayment(payload.payment);
      setError("");
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Không đọc được trạng thái thanh toán.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!paymentCode) return;
    const timer = window.setTimeout(() => void loadPayment(paymentCode), 0);
    return () => window.clearTimeout(timer);
  }, [loadPayment, paymentCode]);

  useEffect(() => {
    if (!paymentCode || (payment && terminalStatuses.has(payment.status))) return;
    const timer = window.setInterval(() => void loadPayment(paymentCode, true), 2_000);
    return () => window.clearInterval(timer);
  }, [loadPayment, payment, paymentCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const createPayment = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const marker = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const orderId = `SEPAY-2K-${marker}`;
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "order.create",
          data: {
            orderId,
            orderCode: orderId,
            customerName: "SePay 2K Webhook Test",
            channel: "webapp",
            siteId: "site-my-dinh",
            fulfillmentType: "pickup",
            deliveryAddress: "Kiểm thử webhook SePay — không làm món, không giao hàng",
            paymentMethod: "bank_transfer",
            promisedAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            note: "Đơn kỹ thuật 2.000đ chỉ dùng kiểm thử SePay webhook",
            items: [{ productCode: "TEST-SEPAY-2K", quantity: 1 }],
          },
        }),
      });
      const payload = await response.json().catch(() => ({})) as { result?: { payment?: Payment } } & ApiError;
      const nextPayment = payload.result?.payment;
      if (!response.ok || !nextPayment) throw new Error(payload.error || "Không tạo được mã kiểm thử.");
      setPaymentCode(nextPayment.paymentCode);
      setPayment(nextPayment);
      window.history.replaceState({}, "", `/sepay-test?code=${encodeURIComponent(nextPayment.paymentCode)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tạo được mã kiểm thử.");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 1_800);
    } catch {
      setError("Trình duyệt chưa cho phép sao chép. Bạn có thể nhấn giữ để sao chép thủ công.");
    }
  };

  const remainingSeconds = payment ? Math.max(0, Math.ceil((new Date(payment.expiresAt).getTime() - now) / 1_000)) : 0;
  const remainingLabel = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const currentStatus = payment ? statusCopy(payment) : null;
  const receivedPercent = payment ? Math.min(100, Math.round(payment.receivedAmount / payment.amount * 100)) : 0;
  const completed = payment ? ["paid", "overpaid"].includes(payment.status) : false;
  const pageLink = typeof window === "undefined" ? "" : window.location.href;

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <header className={styles.header}>
          <a href="/order"><ArrowLeft size={18} /> Quay lại đặt món</a>
          <span><ShieldCheck size={16} /> Chế độ kiểm thử</span>
        </header>

        <div className={styles.intro}>
          <div className={styles.brandMark}>ĐC</div>
          <div>
            <small>ĐẢO CHÈ · SEPAY DIAGNOSTIC</small>
            <h1>Kiểm thử nhận tiền tự động</h1>
            <p>Một trang độc lập để kiểm tra TPBank → SePay → webhook → database.</p>
          </div>
        </div>

        {!payment && (
          <section className={styles.emptyCard}>
            <span><Webhook size={34} /></span>
            <h2>{loading ? "Đang đọc mã kiểm thử…" : "Tạo giao dịch kiểm thử 2.000đ"}</h2>
            <p>Hệ thống sẽ tạo một đơn kỹ thuật trong kho dữ liệu test và sinh QR TPBank riêng, không làm món và không giao hàng.</p>
            {error && <div className={styles.error}><TriangleAlert size={17} /> {error}</div>}
            {!loading && <button type="button" onClick={() => void createPayment()} disabled={creating}>
              {creating ? <LoaderCircle className={styles.spin} size={19} /> : <CreditCard size={19} />}
              {creating ? "Đang tạo mã…" : "Tạo mã 2.000đ"}
            </button>}
          </section>
        )}

        {payment && currentStatus && (
          <>
            <section className={`${styles.statusCard} ${styles[currentStatus.tone]}`} aria-live="polite">
              <span className={styles.statusIcon}>{completed ? <CheckCircle2 size={30} /> : payment.status === "partially_paid" ? <RefreshCw size={28} /> : payment.status === "pending" ? <LoaderCircle className={styles.spin} size={29} /> : <TriangleAlert size={29} />}</span>
              <div>
                <small>{currentStatus.eyebrow}</small>
                <h2>{currentStatus.title}</h2>
                <p>{currentStatus.note}</p>
              </div>
              {!terminalStatuses.has(payment.status) && <strong>{remainingLabel}</strong>}
            </section>

            <section className={styles.paymentGrid}>
              <div className={styles.qrCard}>
                <div className={styles.qrHeading}><span>QUÉT QR TRÊN ỨNG DỤNG NGÂN HÀNG</span><b>{money(payment.amount)}</b></div>
                <div className={styles.qrFrame}>
                  <Image src={payment.qrUrl} width={420} height={420} unoptimized priority alt={`QR chuyển khoản ${money(payment.amount)} tới ${payment.bankAccount}`} />
                </div>
                <p><Clock3 size={15} /> Mã hết hạn lúc {timeLabel(payment.expiresAt)}</p>
              </div>

              <div className={styles.detailsCard}>
                <div className={styles.detailRow}><span>Ngân hàng</span><strong>{payment.bankCode}</strong></div>
                <div className={styles.detailRow}><span>Số tài khoản</span><strong>{payment.bankAccount}</strong><button type="button" onClick={() => void copy(payment.bankAccount, "account")} aria-label="Sao chép số tài khoản">{copied === "account" ? <Check size={17} /> : <Copy size={17} />}</button></div>
                <div className={styles.detailRow}><span>Số tiền</span><strong>{money(payment.amount)}</strong><button type="button" onClick={() => void copy(String(payment.amount), "amount")} aria-label="Sao chép số tiền">{copied === "amount" ? <Check size={17} /> : <Copy size={17} />}</button></div>
                <div className={`${styles.detailRow} ${styles.codeRow}`}><span>Nội dung bắt buộc</span><strong>{payment.paymentCode}</strong><button type="button" onClick={() => void copy(payment.paymentCode, "code")} aria-label="Sao chép nội dung">{copied === "code" ? <Check size={17} /> : <Copy size={17} />}</button></div>
                <div className={styles.progressBlock}>
                  <div><span>Backend đã nhận</span><strong>{money(payment.receivedAmount)} / {money(payment.amount)}</strong></div>
                  <i><b style={{ width: `${receivedPercent}%` }} /></i>
                </div>
                {payment.paidAt && <div className={styles.receipt}><CheckCircle2 size={19} /><div><span>Xác nhận lúc</span><strong>{timeLabel(payment.paidAt)}</strong></div></div>}
                {error && <div className={styles.error}><TriangleAlert size={17} /> {error}</div>}
                <div className={styles.secondaryActions}>
                  <button type="button" onClick={() => void loadPayment(payment.paymentCode)} disabled={loading}><RefreshCw className={loading ? styles.spin : ""} size={17} /> Kiểm tra ngay</button>
                  <button type="button" onClick={() => void copy(pageLink, "link")}><Copy size={17} /> {copied === "link" ? "Đã sao chép" : "Sao chép link"}</button>
                </div>
              </div>
            </section>

            <section className={styles.flowCard}>
              <h2>Giao diện sẽ tự chuyển như sau</h2>
              <div className={styles.flowSteps}>
                <article className={styles.flowActive}><span>1</span><div><strong>Đang chờ chuyển khoản</strong><small>QR và mã nội dung đã sẵn sàng</small></div><Check size={18} /></article>
                <article className={payment.receivedAmount > 0 ? styles.flowActive : ""}><span>2</span><div><strong>SePay nhận giao dịch</strong><small>Webhook gửi dữ liệu về Railway</small></div>{payment.receivedAmount > 0 ? <Check size={18} /> : <Webhook size={18} />}</article>
                <article className={completed ? styles.flowActive : ""}><span>3</span><div><strong>Backend tự đối soát</strong><small>Trang chuyển xanh, không cần tải lại</small></div>{completed ? <Check size={18} /> : <ShieldCheck size={18} />}</article>
              </div>
            </section>

            <button className={styles.newCodeButton} type="button" onClick={() => void createPayment()} disabled={creating}>
              {creating ? <LoaderCircle className={styles.spin} size={18} /> : <RefreshCw size={18} />} Tạo mã 2.000đ mới
            </button>
          </>
        )}
      </section>
    </main>
  );
}
