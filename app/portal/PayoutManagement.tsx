"use client";

/**
 * Chi trả hoa hồng theo lô (M6).
 *
 * Trước màn hình này, kỳ chi trả chỉ chạy được bằng cách gọi API thủ công —
 * nghĩa là trên thực tế chưa ai chi trả được đồng nào qua hệ thống.
 *
 * Ba việc, đúng thứ tự nghiệp vụ:
 *   1. Gom hoa hồng đủ điều kiện của một kỳ thành lô.
 *   2. Tải file chuyển khoản, mang lên ngân hàng.
 *   3. Đánh dấu đã trả, KÈM mã giao dịch ngân hàng.
 *
 * Bước 3 bắt buộc có mã giao dịch: đánh dấu đã trả mà không có chứng từ thì sổ
 * sách nói tiền đã ra nhưng không ai đối chiếu được với ngân hàng.
 */

import { Banknote, Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./PayoutManagement.module.css";

type Batch = {
  id: string;
  batchCode: string;
  counterpartyType: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  taxWithheld: number;
  entryCount: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

type Props = { canPayout: boolean };

const COUNTERPARTY_LABEL: Record<string, string> = {
  affiliate: "Cộng tác viên",
  group_host: "Chủ phòng nhóm",
  partner: "Đối tác",
  store: "Cửa hàng",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  ready: "Sẵn sàng chuyển",
  paid: "Đã trả",
};

function money(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function firstDayOfThisMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export default function PayoutManagement({ canPayout }: Props) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState({
    counterpartyType: "affiliate",
    periodStart: firstDayOfThisMonth(),
    periodEnd: new Date().toISOString().slice(0, 10),
  });
  const [reference, setReference] = useState<Record<string, string>>({});
  const [forbidden, setForbidden] = useState(false);

  const loadBatches = useCallback(async () => {
    try {
      const response = await fetch("/api/payouts", { cache: "no-store", credentials: "same-origin" });
      // 401/403 KHÔNG phải "không có lô nào". Hiện danh sách rỗng cho vai trò
      // không được xem là nói dối rằng đã kiểm và chưa có kỳ chi trả nào.
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        setBatches([]);
        return;
      }
      const payload = await response.json() as { batches?: Batch[] };
      if (response.ok) {
        setForbidden(false);
        setBatches(payload.batches || []);
      }
    } catch {
      // Danh sách lô hỏng không được làm vỡ cả tab Tài chính.
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadBatches());
    return () => window.cancelAnimationFrame(frame);
  }, [loadBatches]);

  const report = (text: string, isError: boolean) => {
    setMessage(text);
    setFailed(isError);
  };

  const createBatch = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("create");
    report("", false);
    try {
      const response = await fetch("/api/payouts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", ...form }),
      });
      const payload = await response.json() as { error?: string; batchCode?: string; entryCount?: number; totalAmount?: number; taxWithheld?: number };
      if (!response.ok) throw new Error(payload.error || "Không gom được lô chi trả.");
      report(
        payload.entryCount
          ? `Lô ${payload.batchCode}: ${payload.entryCount} khoản, ${money(payload.totalAmount || 0)}, đã khấu trừ thuế ${money(payload.taxWithheld || 0)}.`
          : `Kỳ này không có hoa hồng nào đủ điều kiện chi trả.`,
        false,
      );
      await loadBatches();
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "Không gom được lô chi trả.", true);
    } finally {
      setBusy("");
    }
  };

  const markPaid = async (batch: Batch) => {
    const providerReference = (reference[batch.id] || "").trim();
    if (!providerReference) {
      report("Cần mã giao dịch ngân hàng thì mới đánh dấu đã trả được.", true);
      return;
    }
    setBusy(batch.id);
    report("", false);
    try {
      const response = await fetch("/api/payouts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-paid", batchId: batch.id, providerReference }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Không đánh dấu được đã trả.");
      report(`Lô ${batch.batchCode} đã ghi nhận chuyển khoản ${providerReference}.`, false);
      setReference((current) => ({ ...current, [batch.id]: "" }));
      await loadBatches();
    } catch (cause) {
      report(cause instanceof Error ? cause.message : "Không đánh dấu được đã trả.", true);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span><Banknote size={22} /></span>
        <div>
          <small>CHI TRẢ HOA HỒNG</small>
          <strong>Kỳ chi trả theo lô</strong>
          <p>Gom hoa hồng đủ điều kiện, xuất file chuyển khoản, rồi ghi nhận mã giao dịch ngân hàng.</p>
        </div>
        <button type="button" onClick={() => void loadBatches()} aria-label="Làm mới danh sách lô">
          <RefreshCw size={15} />
        </button>
      </div>

      {canPayout && (
        <form className={styles.form} onSubmit={createBatch}>
          <label>
            <span>Đối tượng</span>
            <select value={form.counterpartyType} onChange={(event) => setForm({ ...form, counterpartyType: event.target.value })}>
              {Object.entries(COUNTERPARTY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span>Từ ngày</span>
            <input type="date" required value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })} />
          </label>
          <label>
            <span>Đến ngày</span>
            <input type="date" required value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })} />
          </label>
          <button type="submit" disabled={busy === "create"}>
            {busy === "create" ? "Đang gom…" : "Gom lô chi trả"}
          </button>
        </form>
      )}

      {message && <p className={`${styles.result} ${failed ? styles.error : ""}`}>{message}</p>}

      <div className={styles.batches}>
        {batches.map((batch) => (
          <article key={batch.id} className={styles.batch}>
            <div className={styles.batchTop}>
              <div>
                <strong>{batch.batchCode}</strong>
                <small>{COUNTERPARTY_LABEL[batch.counterpartyType] || batch.counterpartyType} · {batch.periodStart} → {batch.periodEnd}</small>
              </div>
              <em className={batch.status === "paid" ? styles.paid : styles.pending}>{STATUS_LABEL[batch.status] || batch.status}</em>
            </div>
            <dl className={styles.batchFacts}>
              <span><dt>Số khoản</dt><dd>{batch.entryCount}</dd></span>
              <span><dt>Tổng chi</dt><dd>{money(batch.totalAmount)}</dd></span>
              {/* Thuế TNCN 10% khấu trừ từ 2 triệu — hiện tách riêng để đối chiếu được. */}
              <span><dt>Thuế đã khấu trừ</dt><dd>{money(batch.taxWithheld)}</dd></span>
            </dl>
            <div className={styles.batchActions}>
              <a
                className={styles.download}
                href={`/api/payouts?batchId=${encodeURIComponent(batch.id)}&format=csv`}
                download
              >
                <Download size={15} /> Tải file chuyển khoản
              </a>
              {canPayout && batch.status !== "paid" && (
                <>
                  <input
                    aria-label={`Mã giao dịch ngân hàng cho lô ${batch.batchCode}`}
                    placeholder="Mã giao dịch ngân hàng"
                    value={reference[batch.id] || ""}
                    onChange={(event) => setReference((current) => ({ ...current, [batch.id]: event.target.value }))}
                  />
                  <button type="button" disabled={busy === batch.id} onClick={() => void markPaid(batch)}>
                    {busy === batch.id ? "Đang ghi…" : "Đã chuyển tiền"}
                  </button>
                </>
              )}
              {batch.paidAt && <small className={styles.paidAt}>Trả ngày {batch.paidAt.slice(0, 10)}</small>}
            </div>
          </article>
        ))}
        {forbidden && (
          <p className={styles.empty}>
            <FileSpreadsheet size={17} /> Vai trò hiện tại không được xem kỳ chi trả hoa hồng.
          </p>
        )}
        {!forbidden && !batches.length && (
          <p className={styles.empty}>
            <FileSpreadsheet size={17} /> Chưa có lô chi trả nào. Gom lô đầu tiên khi kỳ hoa hồng đã đủ điều kiện.
          </p>
        )}
      </div>
    </section>
  );
}
