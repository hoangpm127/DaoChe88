"use client";

/**
 * Sổ cái tài chính chi tiết (M10).
 *
 * Khác với ô số tổng ở tab Tài chính: snapshot cắt sổ cái ở một số dòng cố định,
 * nên không thể dùng để đối chiếu một kỳ đầy đủ. Màn hình này đọc thẳng
 * /api/finance/ledger — có phân trang bằng con trỏ nên xem được hết — và
 * /api/finance/summary cho phần tổng của cùng kỳ.
 *
 * Cả hai API đều lọc theo phạm vi quyền của phiên ở tầng SQL.
 */

import { ArrowDownCircle, ArrowUpCircle, BookOpen, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import styles from "./FinanceLedger.module.css";

type Entry = {
  id: string;
  occurredAt: string;
  entryType: string;
  direction: string;
  amount: number;
  status: string;
  description: string;
  referenceCode: string;
};

type Summary = {
  orderCount: number;
  grossRevenue: number;
  workshopCost: number;
  partnerLogistics: number;
  affiliateCommission: number;
  approvedExpenses: number;
  netProfit: number;
};

const PERIODS: Array<[string, string]> = [["7d", "7 ngày"], ["month", "Tháng"], ["quarter", "Quý"]];

const money = (value: number) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;

export default function FinanceLedger({ sites }: { sites: Array<{ id: string; name: string }> }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cursor, setCursor] = useState("");
  const [period, setPeriod] = useState("month");
  const [siteId, setSiteId] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextCursor = "") => {
    setBusy(true);
    try {
      const query = new URLSearchParams();
      if (siteId) query.set("siteId", siteId);
      if (nextCursor) query.set("cursor", nextCursor);
      query.set("limit", "50");

      const summaryQuery = new URLSearchParams({ period });
      if (siteId) summaryQuery.set("siteId", siteId);

      const [ledgerResponse, summaryResponse] = await Promise.all([
        fetch(`/api/finance/ledger?${query}`, { cache: "no-store", credentials: "same-origin" }),
        // Chỉ hỏi phần tổng ở trang đầu: cuộn thêm trang không làm số tổng đổi.
        nextCursor ? null : fetch(`/api/finance/summary?${summaryQuery}`, { cache: "no-store", credentials: "same-origin" }),
      ]);

      if (ledgerResponse.status === 401 || ledgerResponse.status === 403) {
        setForbidden(true);
        setEntries([]);
        setSummary(null);
        return;
      }
      setForbidden(false);

      const ledger = await ledgerResponse.json() as { data?: Entry[]; page?: { nextCursor?: string } };
      if (ledgerResponse.ok) {
        // Trang đầu thì thay, trang sau thì nối — người dùng đang đối chiếu, mất
        // các dòng đã xem là phải cuộn lại từ đầu.
        setEntries((current) => (nextCursor ? [...current, ...(ledger.data || [])] : (ledger.data || [])));
        setCursor(ledger.page?.nextCursor || "");
      }

      if (summaryResponse?.ok) {
        const payload = await summaryResponse.json() as { summary?: Summary };
        if (payload.summary) setSummary(payload.summary);
      }
    } catch {
      // Giữ dữ liệu lần trước thay vì xoá trắng màn hình đang đối chiếu.
    } finally {
      setBusy(false);
    }
  }, [period, siteId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  if (forbidden) {
    return (
      <section className={styles.panel}>
        <div className={styles.heading}>
          <span><BookOpen size={22} /></span>
          <div>
            <small>SỔ CÁI TÀI CHÍNH</small>
            <strong>Vai trò hiện tại không được xem</strong>
            <p>Sổ cái chi tiết dành cho kế toán và quản trị tài chính.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span><BookOpen size={22} /></span>
        <div>
          <small>SỔ CÁI TÀI CHÍNH</small>
          <strong>Từng bút toán, đối chiếu được</strong>
          <p>Xem hết một kỳ bằng phân trang, không bị cắt cụt như ô số tổng quan.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Làm mới sổ cái">
          <RefreshCw size={15} />
        </button>
      </div>

      <div className={styles.filters}>
        <div className={styles.periods}>
          {PERIODS.map(([value, label]) => (
            <button key={value} type="button" className={period === value ? styles.active : ""} onClick={() => setPeriod(value)}>{label}</button>
          ))}
        </div>
        <label>
          <span>Điểm bán</span>
          <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="">Toàn phạm vi của tôi</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
      </div>

      {summary && (
        <div className={styles.totals}>
          <article><small>Doanh thu gộp</small><strong>{money(summary.grossRevenue)}</strong><em>{summary.orderCount} đơn</em></article>
          <article><small>Chi phí xưởng</small><strong>{money(summary.workshopCost)}</strong><em>giá vốn sản xuất</em></article>
          <article><small>Hoa hồng + vận chuyển</small><strong>{money(summary.affiliateCommission + summary.partnerLogistics)}</strong><em>đã trừ khỏi lãi</em></article>
          <article className={summary.netProfit < 0 ? styles.negative : ""}><small>Lãi thuần</small><strong>{money(summary.netProfit)}</strong><em>đã trừ {money(summary.approvedExpenses)} chi phí duyệt</em></article>
        </div>
      )}

      <div className={styles.entries}>
        {entries.map((entry) => (
          <div key={entry.id}>
            <span className={entry.direction === "inflow" ? styles.in : styles.out}>
              {entry.direction === "inflow" ? <ArrowDownCircle size={17} /> : <ArrowUpCircle size={17} />}
            </span>
            <div>
              <strong>{entry.description || entry.entryType}</strong>
              <small>{entry.occurredAt.slice(0, 10)} · {entry.referenceCode || entry.entryType} · {entry.status}</small>
            </div>
            <b className={entry.direction === "inflow" ? styles.in : styles.out}>
              {entry.direction === "inflow" ? "+" : "−"}{money(entry.amount)}
            </b>
          </div>
        ))}
        {!entries.length && !busy && <p className={styles.empty}>Kỳ này chưa có bút toán nào trong phạm vi của bạn.</p>}
      </div>

      {cursor && (
        <button className={styles.more} type="button" disabled={busy} onClick={() => void load(cursor)}>
          {busy ? "Đang tải…" : "Xem thêm"}
        </button>
      )}
    </section>
  );
}
