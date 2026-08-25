"use client";

import { Banknote, Download, FileSpreadsheet, LockKeyhole, ReceiptText, RefreshCw, Scale } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./FinanceReports.module.css";

type Site = { id: string; name: string };
type ReportPayload = { title: string; columns: string[]; rows: Array<Record<string, string | number | null>>; totals?: Record<string, string | number | null>; sourceCount: number; generatedAt: string; error?: string };
type Props = { sites: Site[]; can: (command: string) => boolean; runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean> };

const reportOptions = [
  ["profit-loss", "P&L theo cửa hàng"], ["workshop-profit", "P&L bếp tổng"], ["consolidated-profit", "P&L hợp nhất"],
  ["internal-debt", "Công nợ nội bộ"], ["bank-reconciliation", "Đối soát ngân hàng"], ["commissions", "Hoa hồng phải trả"],
  ["waste", "Hao hụt & kiểm kê"], ["product-revenue", "Doanh thu theo món"], ["revenue-period", "Doanh thu kê khai theo kỳ"],
] as const;

function display(value: string | number | null) {
  if (typeof value === "number") return value.toLocaleString("vi-VN");
  return value || "—";
}

async function fetchFinanceReport(reportName: string, query: string, signal?: AbortSignal) {
  const response = await fetch(`/api/reports/finance/${reportName}?${query}`, { credentials: "same-origin", cache: "no-store", signal });
  const payload = await response.json() as ReportPayload;
  if (!response.ok) throw new Error(payload.error || "Không thể tải báo cáo.");
  return payload;
}

export default function FinanceReports({ sites, can, runCommand }: Props) {
  const now = new Date();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const [reportName, setReportName] = useState("profit-loss");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [siteId, setSiteId] = useState("");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoice, setInvoice] = useState({ orderId: "", buyerName: "", buyerTaxCode: "", buyerAddress: "", buyerEmail: "", vatRateBps: "0" });
  const [period, setPeriod] = useState(now.toISOString().slice(0, 7));
  const [settlement, setSettlement] = useState({ counterpartyType: "affiliate", counterpartyId: "", periodStart: monthStart, periodEnd: now.toISOString().slice(0, 10) });
  const [payment, setPayment] = useState({ siteId: "", amount: "", paymentReference: "" });

  const query = useMemo(() => {
    const params = new URLSearchParams({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` });
    if (siteId) params.set("siteId", siteId);
    return params.toString();
  }, [from, to, siteId]);

  const load = async () => {
    setLoading(true); setError("");
    try {
      setReport(await fetchFinanceReport(reportName, query));
    } catch (cause) {
      setReport(null); setError(cause instanceof Error ? cause.message : "Không thể tải báo cáo.");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchFinanceReport(reportName, query, controller.signal)
        .then((payload) => { setReport(payload); setError(""); })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) { setReport(null); setError(cause instanceof Error ? cause.message : "Không thể tải báo cáo."); }
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, reportName]);

  const submitInvoice = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await runCommand("einvoice.defer", { ...invoice, vatRateBps: Number(invoice.vatRateBps) }, "Đã lưu thông tin hóa đơn ở trạng thái deferred.");
    if (ok) { setInvoice({ orderId: "", buyerName: "", buyerTaxCode: "", buyerAddress: "", buyerEmail: "", vatRateBps: "0" }); await load(); }
  };

  const closePeriod = async (event: FormEvent) => {
    event.preventDefault();
    await runCommand("accounting-period.close", { periodCode: period, note: "Khóa sổ từ portal" }, `Đã khóa sổ kỳ ${period}.`);
  };

  const createSettlement = async (event: FormEvent) => {
    event.preventDefault();
    await runCommand("finance.settle", { ...settlement, status: "draft" }, "Đã lập kỳ đối soát từ các bút toán nguồn; không nhập tay tổng tiền.");
  };

  const recordPayment = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await runCommand("internal.payment", { ...payment, siteId: payment.siteId || sites[0]?.id || "", amount: Number(payment.amount), description: "Thanh toán công nợ nội bộ từ portal" }, "Đã ghi thanh toán công nợ nội bộ.");
    if (ok) { setPayment((current) => ({ ...current, amount: "", paymentReference: "" })); if (reportName === "internal-debt") await load(); }
  };

  return <section className={styles.shell}>
    <header><div><small>GIAI ĐOẠN 3 · M10</small><h2>Báo cáo từ chứng từ thật</h2><p>COGS tách actual/estimated; mỗi dòng có ID nguồn để truy ngược về database.</p></div><span><Scale size={19} /> {report?.sourceCount || 0} chứng từ nguồn</span></header>
    <div className={styles.toolbar}><label>Báo cáo<select value={reportName} onChange={(event) => setReportName(event.target.value)}>{reportOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label>Điểm<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Theo phạm vi tài khoản</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><button type="button" onClick={() => void load()}><RefreshCw size={16} /> Làm mới</button><a href={`/api/reports/finance/${reportName}?${query}&format=csv`}><Download size={16} /> CSV / Excel</a></div>
    {error && <p className={styles.error}>{error}</p>}
    <div className={styles.tableWrap}><table><thead><tr>{report?.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{report?.rows.slice(0, 50).map((row, index) => <tr key={`${reportName}-${index}`}>{report.columns.map((column) => <td key={column}>{display(row[column])}</td>)}</tr>)}</tbody></table>{loading && <p>Đang tổng hợp từ sổ cái…</p>}{!loading && report?.rows.length === 0 && <p>Chưa có dữ liệu kỳ này.</p>}</div>
    {report?.totals && <div className={styles.totals}>{Object.entries(report.totals).map(([key, value]) => <span key={key}><small>{key}</small><strong>{display(value)}</strong></span>)}</div>}

    <div className={styles.controls}>
      {can("einvoice.defer") && <form onSubmit={submitInvoice}><h3><ReceiptText size={18} /> Lưu yêu cầu hóa đơn điện tử</h3><label>Mã/ID đơn<input required value={invoice.orderId} onChange={(event) => setInvoice({ ...invoice, orderId: event.target.value })} /></label><label>Tên người mua<input required value={invoice.buyerName} onChange={(event) => setInvoice({ ...invoice, buyerName: event.target.value })} /></label><label>Mã số thuế<input value={invoice.buyerTaxCode} onChange={(event) => setInvoice({ ...invoice, buyerTaxCode: event.target.value })} /></label><label>Địa chỉ<input value={invoice.buyerAddress} onChange={(event) => setInvoice({ ...invoice, buyerAddress: event.target.value })} /></label><label>Email<input type="email" value={invoice.buyerEmail} onChange={(event) => setInvoice({ ...invoice, buyerEmail: event.target.value })} /></label><label>VAT (basis point)<input type="number" min="0" max="10000" value={invoice.vatRateBps} onChange={(event) => setInvoice({ ...invoice, vatRateBps: event.target.value })} /></label><button>Lưu deferred</button><p>Khung này không gọi Viettel/VNPT/MISA. Bán thật vẫn phải xuất hóa đơn theo quy trình pháp lý hiện hành.</p></form>}
      {can("finance.settle") && <form onSubmit={createSettlement}><h3><FileSpreadsheet size={18} /> Lập kỳ đối soát tự động</h3><label>Đối tượng<select value={settlement.counterpartyType} onChange={(event) => setSettlement({ ...settlement, counterpartyType: event.target.value })}><option value="affiliate">Affiliate</option><option value="partner">Đối tác</option><option value="location">Điểm bán</option><option value="shipper">Shipper</option></select></label><label>Mã đối tượng<input required value={settlement.counterpartyId} onChange={(event) => setSettlement({ ...settlement, counterpartyId: event.target.value })} /></label><label>Từ ngày<input required type="date" value={settlement.periodStart} onChange={(event) => setSettlement({ ...settlement, periodStart: event.target.value })} /></label><label>Đến ngày<input required type="date" value={settlement.periodEnd} onChange={(event) => setSettlement({ ...settlement, periodEnd: event.target.value })} /></label><button>Lập từ sổ cái</button><p>Không có ô tổng tiền: hệ thống chọn từng bút toán đủ điều kiện và tự cộng.</p></form>}
      {can("internal.payment") && <form onSubmit={recordPayment}><h3><Banknote size={18} /> Thanh toán công nợ bếp</h3><label>Điểm bán<select value={payment.siteId || sites[0]?.id || ""} onChange={(event) => setPayment({ ...payment, siteId: event.target.value })}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>Số tiền VND<input required type="number" min="1" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></label><label>Mã tham chiếu ngân hàng<input required value={payment.paymentReference} onChange={(event) => setPayment({ ...payment, paymentReference: event.target.value })} /></label><button>Ghi thanh toán</button></form>}
      {can("accounting-period.close") && <form onSubmit={closePeriod}><h3><LockKeyhole size={18} /> Khóa sổ kỳ</h3><label>Kỳ YYYY-MM<input required pattern="\d{4}-(0[1-9]|1[0-2])" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><button>Khóa sổ</button><p>Cả tầng ứng dụng và trigger database sẽ chặn ghi/sửa bút toán vào kỳ đã khóa.</p></form>}
    </div>
  </section>;
}
