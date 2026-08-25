"use client";

/**
 * Truy xuất nguồn gốc một đơn hàng (M7).
 *
 * Đi ngược chuỗi: đơn → dòng món → mẻ sản xuất → lô nguyên liệu → đơn mua →
 * nhà cung cấp. Đây là thứ phải trả lời được khi có sự cố an toàn thực phẩm,
 * hoặc khi khách hỏi "món này làm từ gì, ngày nào".
 *
 * Backend M7 đã có từ 2026-08-19 nhưng chưa màn hình nào gọi tới, nên trên thực
 * tế chưa ai truy xuất được đơn nào.
 *
 * `traceComplete=false` KHÔNG có nghĩa là dữ liệu sai — nghĩa là đơn này chưa
 * gắn được tới mẻ hoặc lô nguyên liệu. Màn hình nói thẳng điều đó thay vì hiện
 * bảng rỗng, vì bảng rỗng dễ bị đọc nhầm thành "đã kiểm và không có gì".
 */

import { AlertTriangle, PackageSearch, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import styles from "./OrderTraceability.module.css";

type Consumption = {
  productCode: string;
  productName: string;
  quantity: number;
  batchCode: string | null;
  producedAt: string | null;
  expiresAt: string | null;
  qualityCheckBy: string | null;
  qualityNote: string | null;
};

type MaterialUsage = {
  materialSku: string;
  quantity: number;
  poCode: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  materialExpiresAt: string | null;
};

type Trace = {
  ok: boolean;
  error?: string;
  order?: { id: string; orderCode: string; siteId: string };
  consumptions?: Consumption[];
  materialUsage?: MaterialUsage[];
  productionBatchIds?: string[];
  traceComplete?: boolean;
};

function dayOf(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : "—";
}

export default function OrderTraceability() {
  const [orderCode, setOrderCode] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const query = orderCode.trim();
    if (!query || busy) return;
    setBusy(true);
    setError("");
    setTrace(null);
    try {
      const response = await fetch(`/api/traceability?orderId=${encodeURIComponent(query)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json() as Trace;
      if (!response.ok) {
        setError(payload.error || "Không truy xuất được đơn này.");
        return;
      }
      setTrace(payload);
    } catch {
      setError("Không kết nối được máy chủ. Bạn kiểm tra mạng rồi thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span><PackageSearch size={22} /></span>
        <div>
          <small>TRUY XUẤT NGUỒN GỐC</small>
          <strong>Từ đơn hàng ngược về nhà cung cấp</strong>
          <p>Nhập mã đơn để xem món được làm từ mẻ nào, mẻ dùng lô nguyên liệu nào, lô mua của ai.</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={lookup}>
        <label>
          <span>Mã đơn hàng</span>
          <input
            required
            placeholder="DC-260825-…"
            value={orderCode}
            onChange={(event) => setOrderCode(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          <Search size={15} /> {busy ? "Đang tra…" : "Truy xuất"}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {trace?.order && (
        <div className={styles.result}>
          <div className={styles.resultTop}>
            <strong>{trace.order.orderCode}</strong>
            {trace.traceComplete
              ? <em className={styles.complete}>Truy xuất đầy đủ</em>
              : <em className={styles.partial}><AlertTriangle size={13} /> Chưa đủ mắt xích</em>}
          </div>

          {!trace.traceComplete && (
            <p className={styles.notice}>
              Đơn này chưa gắn được tới mẻ sản xuất hoặc lô nguyên liệu. Thường gặp với đơn tạo
              trước khi bật quản lý mẻ, hoặc món không đi qua bếp tổng.
            </p>
          )}

          <h3>Món → mẻ sản xuất</h3>
          <div className={styles.rows}>
            {(trace.consumptions || []).map((row, index) => (
              <div key={`${row.productCode}-${row.batchCode}-${index}`}>
                <span>
                  <strong>{row.productName}</strong>
                  <small>{row.productCode} · {row.quantity} phần</small>
                </span>
                <span className={styles.rowRight}>
                  <strong>{row.batchCode || "Chưa gắn mẻ"}</strong>
                  <small>SX {dayOf(row.producedAt)} · HSD {dayOf(row.expiresAt)}</small>
                </span>
              </div>
            ))}
            {!(trace.consumptions || []).length && <small className={styles.empty}>Không có dòng món nào gắn với mẻ sản xuất.</small>}
          </div>

          <h3>Mẻ → lô nguyên liệu → nhà cung cấp</h3>
          <div className={styles.rows}>
            {(trace.materialUsage || []).map((row, index) => (
              <div key={`${row.materialSku}-${row.poCode}-${index}`}>
                <span>
                  <strong>{row.materialSku}</strong>
                  <small>{row.quantity} · HSD {dayOf(row.materialExpiresAt)}</small>
                </span>
                <span className={styles.rowRight}>
                  <strong>{row.supplierName || "Chưa rõ nhà cung cấp"}</strong>
                  <small>{[row.supplierCode, row.poCode].filter(Boolean).join(" · ") || "Chưa có đơn mua"}</small>
                </span>
              </div>
            ))}
            {!(trace.materialUsage || []).length && <small className={styles.empty}>Không có lô nguyên liệu nào gắn với các mẻ của đơn này.</small>}
          </div>
        </div>
      )}
    </section>
  );
}
