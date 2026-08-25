"use client";

import { Banknote, FileSpreadsheet, RefreshCw } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./CashReconciliation.module.css";

type Holder = { actorUserId: string; siteId: string; siteName: string; holderName: string; movementCount: number; amount: number };
type Props = {
  sites: Array<{ id: string; name: string }>;
  canReconcile: boolean;
  canRemit: boolean;
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

export default function CashReconciliation({ sites, canReconcile, canRemit, runCommand }: Props) {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [siteId, setSiteId] = useState(sites[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ statementDate: new Date().toISOString().slice(0, 10), accountNumber: "", openingBalance: "0", closingBalance: "0" });
  const [file, setFile] = useState<File | null>(null);

  const loadHeld = useCallback(async () => {
    try {
      const response = await fetch("/api/reports/cash-held", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as { holders?: Holder[] };
      if (response.ok) setHolders(payload.holders || []);
    } catch { /* Báo cáo phụ không được làm vỡ màn hình quỹ. */ }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadHeld());
    return () => window.cancelAnimationFrame(frame);
  }, [loadHeld]);

  const importStatement = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy("statement");
    setMessage("");
    try {
      const body = new FormData();
      body.set("file", file);
      Object.entries(form).forEach(([key, value]) => body.set(key, value));
      const response = await fetch("/api/reconciliations/bank", { method: "POST", credentials: "same-origin", headers: { "Idempotency-Key": crypto.randomUUID() }, body });
      const payload = await response.json() as { result?: { matchedCount?: number; unmatchedCount?: number }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể nhập sao kê.");
      setMessage(`Đã khớp ${payload.result?.matchedCount || 0} dòng; còn ${payload.result?.unmatchedCount || 0} dòng cần kiểm tra.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Không thể nhập sao kê."); }
    finally { setBusy(""); }
  };

  const remit = async () => {
    if (!siteId) return;
    setBusy("remit");
    const ok = await runCommand("cash.remit", { siteId }, "Đã nộp toàn bộ COD đang giữ vào ca cửa hàng.");
    setBusy("");
    if (ok) await loadHeld();
  };

  return <section className={styles.panel}>
    <div className={styles.heading}><span><Banknote size={22} /></span><div><small>ĐỐI SOÁT TIỀN</small><strong>Sao kê ngân hàng và COD đang giữ</strong><p>Một tài khoản SePay dùng chung; doanh thu vẫn được quy đúng theo mã thanh toán và điểm bán.</p></div></div>
    <div className={styles.grid}>
      {canReconcile && <div className={styles.box}><h3><FileSpreadsheet size={16} /> Nhập sao kê CSV</h3><form className={styles.form} onSubmit={importStatement}>
        <label><span>Ngày sao kê</span><input type="date" required value={form.statementDate} onChange={(event) => setForm({ ...form, statementDate: event.target.value })} /></label>
        <label><span>Số tài khoản</span><input required value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} /></label>
        <label><span>Số dư đầu</span><input type="number" min="0" required value={form.openingBalance} onChange={(event) => setForm({ ...form, openingBalance: event.target.value })} /></label>
        <label><span>Số dư cuối</span><input type="number" min="0" required value={form.closingBalance} onChange={(event) => setForm({ ...form, closingBalance: event.target.value })} /></label>
        <label className={styles.wide}><span>File CSV</span><input type="file" accept=".csv,text/csv" required onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        <button className={styles.wide} disabled={busy === "statement"} type="submit">{busy === "statement" ? "Đang đối chiếu…" : "Nhập và đối chiếu"}</button>
      </form>{message && <p className={`${styles.result} ${message.startsWith("Đã") ? "" : styles.error}`}>{message}</p>}</div>}
      <div className={styles.box}><h3>COD shipper đang giữ</h3><button type="button" onClick={() => void loadHeld()}><RefreshCw size={15} /> Làm mới</button><div className={styles.holders}>{holders.map((holder) => <div key={`${holder.actorUserId}-${holder.siteId}`}><span><strong>{holder.holderName}</strong><small>{holder.siteName} · {holder.movementCount} đơn</small></span><strong>{holder.amount.toLocaleString("vi-VN")}đ</strong></div>)}{!holders.length && <small>Không có khoản COD chưa nộp.</small>}</div>
        {canRemit && <><select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><button disabled={busy === "remit" || !siteId} type="button" onClick={() => void remit()}>{busy === "remit" ? "Đang nộp…" : "Nộp COD vào ca"}</button></>}
      </div>
    </div>
  </section>;
}
