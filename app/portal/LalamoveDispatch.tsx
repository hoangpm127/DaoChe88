"use client";

/**
 * Đặt xe Lalamove thủ công (M9).
 *
 * ==========================================================================
 * VÌ SAO LÀ THỦ CÔNG
 * ==========================================================================
 * Ghi chú M9 chốt: quy trình là NHÂN VIÊN BẤM XÁC NHẬN, không để hệ thống tự
 * gọi tài xế. Gọi xe là tiêu tiền thật, nên phải có người chịu trách nhiệm cho
 * từng chuyến. `LALAMOVE_AUTO_BOOK=false` trên production đúng theo quyết định
 * đó — nhưng cho tới nay chưa có nút nào để bấm, nên trên thực tế không ai đặt
 * được chuyến nào.
 *
 * Bốn thao tác, khớp đúng bốn action của API:
 *   quote   — hỏi giá trước, chưa tốn tiền
 *   book    — chốt chuyến, bắt đầu tính phí
 *   refresh — hỏi lại trạng thái và thông tin tài xế
 *   cancel  — huỷ chuyến
 *
 * Báo giá và đặt chuyến TÁCH LÀM HAI BƯỚC có chủ đích: người bấm phải nhìn thấy
 * số tiền trước khi cam kết.
 */

import { Bike, CircleX, RefreshCw, Search, Truck } from "lucide-react";
import { type FormEvent, useState } from "react";
import styles from "./LalamoveDispatch.module.css";

type Quote = { id: string; orderId: string; status: string; fee: number; currency: string; expiresAt: string | null };
type Driver = { id: string; name: string; phone: string; plateNumber: string };
type Job = {
  id: string;
  orderId: string;
  providerOrderId: string | null;
  status: string;
  fee: number;
  currency: string;
  driver: Driver | null;
  shareLink?: string | null;
};

const money = (value: number) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;

export default function LalamoveDispatch() {
  const [orderCode, setOrderCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const report = (text: string, isError: boolean) => {
    setMessage(text);
    setFailed(isError);
  };

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    const orderId = orderCode.trim();
    if (!orderId) return null;
    setBusy(action);
    report("", false);
    try {
      const response = await fetch("/api/deliveries/lalamove", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId, ...extra }),
      });
      const payload = await response.json() as { error?: string; quote?: Quote; job?: Job; delivery?: { job: Job | null; quote: Quote | null } };
      if (!response.ok) {
        report(payload.error || "Không thao tác được với Lalamove.", true);
        return null;
      }
      return payload;
    } catch {
      report("Không kết nối được máy chủ. Bạn kiểm tra mạng rồi thử lại.", true);
      return null;
    } finally {
      setBusy("");
    }
  };

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const orderId = orderCode.trim();
    if (!orderId || busy) return;
    setBusy("lookup");
    report("", false);
    try {
      const response = await fetch(`/api/deliveries/lalamove?orderId=${encodeURIComponent(orderId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json() as { error?: string; delivery?: { job: Job | null; quote: Quote | null } };
      if (!response.ok) {
        report(payload.error || "Không đọc được chuyến của đơn này.", true);
        setLooked(false);
        return;
      }
      setJob(payload.delivery?.job || null);
      setQuote(payload.delivery?.quote || null);
      setLooked(true);
      if (!payload.delivery?.job && !payload.delivery?.quote) report("Đơn này chưa có báo giá hay chuyến Lalamove nào.", false);
    } catch {
      report("Không kết nối được máy chủ.", true);
    } finally {
      setBusy("");
    }
  };

  const askQuote = async () => {
    const payload = await call("quote");
    if (payload?.quote) {
      setQuote(payload.quote);
      report(`Báo giá ${money(payload.quote.fee)}. Chưa tốn tiền cho tới khi bấm đặt chuyến.`, false);
    }
  };

  const book = async () => {
    const payload = await call("book", quote ? { quoteId: quote.id } : {});
    if (payload?.job) {
      setJob(payload.job);
      report(`Đã đặt chuyến ${payload.job.providerOrderId || payload.job.id}.`, false);
    }
  };

  const refresh = async () => {
    const payload = await call("refresh");
    if (payload?.delivery) {
      setJob(payload.delivery.job);
      report("Đã cập nhật trạng thái chuyến.", false);
    }
  };

  const cancel = async () => {
    const payload = await call("cancel");
    if (payload?.delivery) {
      setJob(payload.delivery.job);
      report("Đã huỷ chuyến Lalamove.", false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span><Bike size={22} /></span>
        <div>
          <small>ĐẶT XE LALAMOVE</small>
          <strong>Gọi xe ngoài cho một đơn</strong>
          <p>Hỏi giá trước, xem số tiền rồi mới chốt chuyến. Hệ thống không tự gọi tài xế.</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={lookup}>
        <label>
          <span>Mã đơn hàng</span>
          <input required placeholder="DC-260825-…" value={orderCode} onChange={(event) => { setOrderCode(event.target.value); setLooked(false); }} />
        </label>
        <button type="submit" disabled={Boolean(busy)}>
          <Search size={15} /> {busy === "lookup" ? "Đang tra…" : "Tra đơn"}
        </button>
      </form>

      {message && <p className={`${styles.result} ${failed ? styles.error : ""}`}>{message}</p>}

      {looked && (
        <div className={styles.state}>
          {quote && !job && (
            <div className={styles.card}>
              <small>BÁO GIÁ HIỆN CÓ</small>
              <strong>{money(quote.fee)}</strong>
              <em>Hết hạn {quote.expiresAt ? quote.expiresAt.slice(11, 16) : "—"} · chưa phát sinh phí</em>
            </div>
          )}

          {job && (
            <div className={styles.card}>
              <small>CHUYẾN ĐÃ ĐẶT · {job.status.toUpperCase()}</small>
              <strong>{money(job.fee)}</strong>
              <em>
                {job.providerOrderId ? `Mã Lalamove ${job.providerOrderId}` : "Chưa có mã nhà cung cấp"}
                {job.driver ? ` · ${job.driver.name} · ${job.driver.plateNumber}` : " · chưa ghép tài xế"}
              </em>
            </div>
          )}

          <div className={styles.actions}>
            {!job && (
              <>
                <button type="button" disabled={Boolean(busy)} onClick={() => void askQuote()}>
                  {busy === "quote" ? "Đang hỏi giá…" : "Hỏi giá"}
                </button>
                {/* Chỉ mở nút đặt chuyến sau khi đã có giá trên màn hình: người bấm
                    phải nhìn thấy số tiền trước khi cam kết chi. */}
                <button className={styles.primary} type="button" disabled={Boolean(busy) || !quote} onClick={() => void book()}>
                  <Truck size={15} /> {busy === "book" ? "Đang đặt…" : "Đặt chuyến"}
                </button>
              </>
            )}
            {job && (
              <>
                <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>
                  <RefreshCw size={15} /> {busy === "refresh" ? "Đang cập nhật…" : "Làm mới"}
                </button>
                <button className={styles.danger} type="button" disabled={Boolean(busy)} onClick={() => void cancel()}>
                  <CircleX size={15} /> {busy === "cancel" ? "Đang huỷ…" : "Huỷ chuyến"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
