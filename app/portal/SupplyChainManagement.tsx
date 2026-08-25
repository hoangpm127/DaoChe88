"use client";

import { AlertTriangle, Boxes, ChefHat, ClipboardCheck, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./SupplyChainManagement.module.css";

type Site = { id: string; name: string; type: string };
type TransferItem = { id: string; productSku: string; quantityRequested: number; quantityShipped: number; quantityReceived: number };
type Transfer = { id: string; transferCode: string; fromSiteId: string; toSiteId: string; fromSiteName: string; toSiteName: string; status: string; transferValue: number; createdAt: string; items: TransferItem[] };
type Batch = { id: string; batchCode: string; siteId: string; productSku: string; plannedQuantity: number; producedQuantity: number; unitCost: number; status: string; expiresAt: string | null };
type StockLot = { id: string; siteId: string; productSku: string; batchId: string | null; quantity: number; unitCost: number; expiresAt: string | null };
type StockCountItem = { id: string; countId: string; productSku: string; systemQuantity: number; countedQuantity: number };
type StockCount = { id: string; siteId: string; countType: string; status: string; varianceValue: number; items: StockCountItem[] };
type Dashboard = { generatedAt: string; transfers: Transfer[]; productionBatches: Batch[]; stockLots: StockLot[]; stockCounts: StockCount[]; replenishment: Array<{ siteId: string; productSku: string; onHand: number; sold7d: number; suggestedQuantity: number }>; internalAccounts: Array<{ id: string; siteId: string; siteName: string; balance: number; creditLimit: number }> };

type Props = {
  sites: Site[];
  can: (command: string) => boolean;
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

const statusLabel: Record<string, string> = { requested: "Chờ duyệt", approved: "Đã duyệt", packed: "Đã đóng", in_transit: "Đang giao", received: "Đã nhận", partially_received: "Nhận thiếu", rejected: "Từ chối", planned: "Đã lập", in_progress: "Đang làm", completed: "Hoàn tất", open: "Đang đếm", submitted: "Chờ duyệt" };

async function fetchSupplyChain(signal?: AbortSignal) {
  const response = await fetch("/api/supply-chain", { credentials: "same-origin", cache: "no-store", signal });
  const payload = await response.json() as Dashboard & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Không thể tải chuỗi cung ứng.");
  return payload;
}

export default function SupplyChainManagement({ sites, can, runCommand }: Props) {
  const kitchen = useMemo(() => sites.find((site) => site.type.includes("kitchen") || site.id.includes("central")) || sites[0], [sites]);
  const store = useMemo(() => sites.find((site) => site.id !== kitchen?.id) || sites[0], [sites, kitchen]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [transferForm, setTransferForm] = useState({ fromSiteId: kitchen?.id || "", toSiteId: store?.id || "", productSku: "", quantity: "" });
  const [productionForm, setProductionForm] = useState({ siteId: kitchen?.id || "", productSku: "", plannedQuantity: "" });
  const [receipt, setReceipt] = useState<Record<string, string>>({});
  const [discrepancyReason, setDiscrepancyReason] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard(await fetchSupplyChain());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải chuỗi cung ứng.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchSupplyChain(controller.signal)
        .then((payload) => { setDashboard(payload); setError(""); })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Không thể tải chuỗi cung ứng."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, []);

  const act = async (command: string, data: Record<string, unknown>, success: string) => {
    setBusy(`${command}:${String(data.transferId || data.batchId || data.countId || "new")}`);
    const ok = await runCommand(command, data, success);
    setBusy("");
    if (ok) await load();
    return ok;
  };

  const requestTransfer = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act("transfer.request", { fromSiteId: transferForm.fromSiteId || kitchen?.id || "", toSiteId: transferForm.toSiteId || store?.id || "", items: [{ productSku: transferForm.productSku, quantity: Number(transferForm.quantity) }] }, "Đã tạo phiếu điều chuyển.");
    if (ok) setTransferForm((current) => ({ ...current, productSku: "", quantity: "" }));
  };

  const receiveTransfer = (transfer: Transfer) => act("transfer.receive", {
    transferId: transfer.id,
    items: transfer.items.map((item) => {
      const received = receipt[item.id] === undefined ? item.quantityShipped : Number(receipt[item.id]);
      return { itemId: item.id, quantityReceived: received, quantityDamaged: 0, reason: received < item.quantityShipped ? discrepancyReason[item.id] || "Thiếu khi bàn giao" : "" };
    }),
  }, `Đã xác nhận nhận ${transfer.transferCode}.`);

  const planProduction = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await act("production.plan", { siteId: productionForm.siteId || kitchen?.id || "", productSku: productionForm.productSku, plannedQuantity: Number(productionForm.plannedQuantity) }, "Đã lập mẻ sản xuất.");
    if (ok) setProductionForm((current) => ({ ...current, productSku: "", plannedQuantity: "" }));
  };

  const submitCount = (count: StockCount) => act("stockcount.submit", {
    countId: count.id,
    items: count.items.map((item) => ({ productSku: item.productSku, countedQuantity: Number(counted[item.id] ?? item.systemQuantity), reason: Number(counted[item.id] ?? item.systemQuantity) === item.systemQuantity ? "" : "Chênh lệch kiểm đếm thực tế" })),
  }, "Đã gửi phiếu kiểm kê để duyệt.");

  const activeTransfers = dashboard?.transfers.filter((transfer) => !["received", "rejected", "cancelled"].includes(transfer.status)) || [];
  const activeBatches = dashboard?.productionBatches.filter((batch) => batch.status !== "completed") || [];
  const expiryThreshold = dashboard ? new Date(dashboard.generatedAt).getTime() + 24 * 60 * 60_000 : 0;
  const expiringLots = dashboard?.stockLots.filter((lot) => lot.expiresAt && new Date(lot.expiresAt).getTime() < expiryThreshold) || [];

  return <section className={styles.shell}>
    <header><div><small>GIAI ĐOẠN 3 · M7</small><h2>Chuỗi cung ứng theo lô & FEFO</h2><p>Mua → sản xuất → điều chuyển → nhận hàng → bán; mọi giá vốn đi từ lô thực.</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /> {loading ? "Đang tải" : "Làm mới"}</button></header>
    {error && <div className={styles.error}><AlertTriangle size={18} /> {error}</div>}
    <div className={styles.kpis}>
      <article><Truck /><span><small>Phiếu đang chạy</small><strong>{activeTransfers.length}</strong></span></article>
      <article><ChefHat /><span><small>Mẻ đang làm</small><strong>{activeBatches.length}</strong></span></article>
      <article><Boxes /><span><small>Lô còn hàng</small><strong>{dashboard?.stockLots.length || 0}</strong></span></article>
      <article className={expiringLots.length ? styles.warning : ""}><AlertTriangle /><span><small>Hết hạn &lt;24h</small><strong>{expiringLots.length}</strong></span></article>
    </div>

    {(can("transfer.request") || can("production.plan") || can("stockcount.open")) && <div className={styles.forms}>
      {can("transfer.request") && <form onSubmit={requestTransfer}><h3><Truck size={18} /> Tạo phiếu điều chuyển</h3><label>Điểm xuất<select value={transferForm.fromSiteId || kitchen?.id || ""} onChange={(event) => setTransferForm({ ...transferForm, fromSiteId: event.target.value })}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>Điểm nhận<select value={transferForm.toSiteId || store?.id || ""} onChange={(event) => setTransferForm({ ...transferForm, toSiteId: event.target.value })}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>SKU<input required value={transferForm.productSku} onChange={(event) => setTransferForm({ ...transferForm, productSku: event.target.value.toUpperCase() })} /></label><label>Số lượng<input required min="1" type="number" value={transferForm.quantity} onChange={(event) => setTransferForm({ ...transferForm, quantity: event.target.value })} /></label><button disabled={Boolean(busy)}>Tạo phiếu</button></form>}
      {can("production.plan") && <form onSubmit={planProduction}><h3><ChefHat size={18} /> Lập mẻ sản xuất</h3><label>Bếp<select value={productionForm.siteId || kitchen?.id || ""} onChange={(event) => setProductionForm({ ...productionForm, siteId: event.target.value })}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>SKU thành phẩm<input required value={productionForm.productSku} onChange={(event) => setProductionForm({ ...productionForm, productSku: event.target.value.toUpperCase() })} /></label><label>Số phần dự kiến<input required min="1" type="number" value={productionForm.plannedQuantity} onChange={(event) => setProductionForm({ ...productionForm, plannedQuantity: event.target.value })} /></label><button disabled={Boolean(busy)}>Lập kế hoạch</button></form>}
      {can("stockcount.open") && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void act("stockcount.open", { siteId: String(form.get("siteId")), countType: "shift_close" }, "Đã mở kiểm kê cuối ca."); }}><h3><ClipboardCheck size={18} /> Kiểm kê cuối ca</h3><label>Điểm kiểm kê<select name="siteId">{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><p>Hệ thống chụp số tồn hiện tại; chênh lệch phải có lý do và được duyệt.</p><button disabled={Boolean(busy)}>Mở phiếu kiểm kê</button></form>}
    </div>}

    <div className={styles.grid}>
      <section><h3><Truck size={18} /> Điều chuyển & nhận hàng</h3>{activeTransfers.length === 0 ? <p className={styles.empty}>Không có phiếu đang xử lý.</p> : activeTransfers.map((transfer) => <article className={styles.card} key={transfer.id}><div><span>{statusLabel[transfer.status] || transfer.status}</span><strong>{transfer.transferCode}</strong><small>{transfer.fromSiteName} → {transfer.toSiteName}</small></div><b>{transfer.transferValue.toLocaleString("vi-VN")}đ</b><ul>{transfer.items.map((item) => <li key={item.id}><span>{item.productSku} · xuất {item.quantityShipped || item.quantityRequested}</span>{transfer.status === "in_transit" && <><input aria-label={`Thực nhận ${item.productSku}`} type="number" min="0" max={item.quantityShipped} value={receipt[item.id] ?? String(item.quantityShipped)} onChange={(event) => setReceipt({ ...receipt, [item.id]: event.target.value })} />{Number(receipt[item.id] ?? item.quantityShipped) < item.quantityShipped && <input aria-label={`Lý do ${item.productSku}`} placeholder="Lý do thiếu/hỏng" value={discrepancyReason[item.id] || ""} onChange={(event) => setDiscrepancyReason({ ...discrepancyReason, [item.id]: event.target.value })} />}</>}</li>)}</ul><footer>
          {transfer.status === "requested" && can("transfer.approve") && <button onClick={() => void act("transfer.approve", { transferId: transfer.id }, `Đã duyệt ${transfer.transferCode}.`)}>Duyệt</button>}
          {transfer.status === "approved" && can("transfer.pack") && <button onClick={() => void act("transfer.pack", { transferId: transfer.id }, `Đã đóng ${transfer.transferCode} theo FEFO.`)}>Đóng theo FEFO</button>}
          {transfer.status === "packed" && can("transfer.ship") && <button onClick={() => void act("transfer.ship", { transferId: transfer.id }, `Đã xuất ${transfer.transferCode}.`)}>Xuất xe</button>}
          {transfer.status === "in_transit" && can("transfer.receive") && <button onClick={() => void receiveTransfer(transfer)}>Xác nhận thực nhận</button>}
          {["requested", "approved"].includes(transfer.status) && can("transfer.reject") && <button className={styles.secondary} onClick={() => void act("transfer.reject", { transferId: transfer.id, reason: "Cửa hàng từ chối phiếu" }, `Đã từ chối ${transfer.transferCode}.`)}>Từ chối</button>}
        </footer></article>)}</section>

      <section><h3><ChefHat size={18} /> Mẻ sản xuất</h3>{activeBatches.length === 0 ? <p className={styles.empty}>Không có mẻ đang chạy.</p> : activeBatches.map((batch) => <article className={styles.card} key={batch.id}><div><span>{statusLabel[batch.status] || batch.status}</span><strong>{batch.batchCode}</strong><small>{batch.productSku} · kế hoạch {batch.plannedQuantity} phần</small></div><footer>{batch.status === "planned" && can("production.start") && <button onClick={() => void act("production.start", { batchId: batch.id }, `Đã bắt đầu ${batch.batchCode}.`)}>Bắt đầu</button>}{batch.status === "in_progress" && can("production.complete") && <button onClick={() => void act("production.complete", { batchId: batch.id, producedQuantity: batch.plannedQuantity, rejectedQuantity: 0, laborCost: 0, overheadCost: 0, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), qualityNote: "Đạt QA" }, `Đã hoàn tất ${batch.batchCode} và nhập kho theo lô.`)}>Hoàn tất & nhập kho</button>}</footer></article>)}</section>
    </div>

    {(dashboard?.stockCounts.length || 0) > 0 && <section className={styles.counts}><h3><ClipboardCheck size={18} /> Phiếu kiểm kê</h3>{dashboard!.stockCounts.slice(0, 5).map((count) => <article className={styles.card} key={count.id}><div><span>{statusLabel[count.status] || count.status}</span><strong>{count.id}</strong><small>{count.countType} · chênh lệch {count.varianceValue.toLocaleString("vi-VN")}đ</small></div>{count.status === "open" && <ul>{count.items.map((item) => <li key={item.id}><span>{item.productSku} · hệ thống {item.systemQuantity}</span><input aria-label={`Kiểm đếm ${item.productSku}`} type="number" min="0" value={counted[item.id] ?? String(item.systemQuantity)} onChange={(event) => setCounted({ ...counted, [item.id]: event.target.value })} /></li>)}</ul>}<footer>{count.status === "open" && can("stockcount.submit") && <button onClick={() => void submitCount(count)}>Gửi duyệt</button>}{count.status === "submitted" && can("stockcount.approve") && <button onClick={() => void act("stockcount.approve", { countId: count.id }, "Đã duyệt kiểm kê và ghi điều chỉnh.")}>Duyệt điều chỉnh</button>}</footer></article>)}</section>}

    <section className={styles.lots}><h3><PackageCheck size={18} /> Tồn theo lô FEFO</h3><div>{dashboard?.stockLots.slice(0, 12).map((lot) => <article key={lot.id}><span>{lot.productSku}</span><strong>{lot.quantity} phần · {lot.unitCost.toLocaleString("vi-VN")}đ/phần</strong><small>Lô {lot.batchId || "kế thừa"} · HSD {lot.expiresAt ? new Date(lot.expiresAt).toLocaleString("vi-VN") : "không đặt"}</small></article>)}</div>{!dashboard?.stockLots.length && <p className={styles.empty}>Chưa có tồn thành phẩm theo lô.</p>}</section>

    <section className={styles.replenishment}><h3><Boxes size={18} /> Gợi ý nhập hàng theo tốc độ bán 7 ngày</h3><div>{dashboard?.replenishment.filter((row) => row.suggestedQuantity > 0).slice(0, 12).map((row) => <article key={`${row.siteId}-${row.productSku}`}><strong>{row.productSku}</strong><span>Tồn {row.onHand} · bán 7 ngày {row.sold7d}</span><b>Đề xuất +{row.suggestedQuantity}</b></article>)}</div>{!dashboard?.replenishment.some((row) => row.suggestedQuantity > 0) && <p className={styles.empty}>Chưa có SKU nào cần bổ sung theo mô hình 3 ngày dự trữ.</p>}</section>
  </section>;
}
