"use client";

import { CheckCircle2, ChefHat, Clock3, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import styles from "./KitchenQueue.module.css";

type KitchenItem = { itemId: string; productCode: string; productName: string; quantity: number; customizationJson: string; note: string; itemStatus: string; startedAt: string | null; doneAt: string | null };
type KitchenOrder = { orderId: string; orderCode: string; customerName: string; fulfillmentType: string; tableLabel: string; groupRoomCode: string | null; promisedAt: string; scheduledFor: string | null; readySuggested: boolean; items: KitchenItem[] };

type Props = {
  sites: Array<{ id: string; name: string }>;
  canStart: boolean;
  canDone: boolean;
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

function time(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

function options(value: string) {
  try {
    const parsed = JSON.parse(value) as { sweetness?: string; temperature?: string; options?: Array<{ name?: string }> };
    return [parsed.sweetness, parsed.temperature, ...(parsed.options || []).map((item) => item.name)].filter(Boolean).join(" · ");
  } catch { return ""; }
}

export default function KitchenQueue({ sites, canStart, canDone, runCommand }: Props) {
  const [siteId, setSiteId] = useState(sites[0]?.id || "");
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!siteId) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/kitchen/queue?siteId=${encodeURIComponent(siteId)}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as { orders?: KitchenOrder[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể tải hàng đợi bếp.");
      setOrders(payload.orders || []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải hàng đợi bếp.");
    } finally { if (!quiet) setLoading(false); }
  }, [siteId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    const timer = window.setInterval(() => void load(true), 4_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [load]);

  const update = async (item: KitchenItem, action: "start" | "done") => {
    setBusy(item.itemId);
    const ok = await runCommand(`order.item.${action}`, { itemId: item.itemId }, action === "start" ? `Đã bắt đầu ${item.productName}.` : `Đã xong ${item.productName}.`);
    setBusy("");
    if (ok) await load(true);
  };

  return <section className={styles.queue}>
    <header><span><ChefHat size={24} /></span><div><small>KDS · TIẾN ĐỘ TỪNG DÒNG MÓN</small><h2>Hàng đợi bếp theo giờ hứa</h2></div><label>Điểm bếp<select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><button type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={17} /></button></header>
    {error && <p className={styles.error}>{error}</p>}
    <div className={styles.orders}>{orders.map((order) => <article key={order.orderId} className={order.readySuggested ? styles.ready : ""}>
      <div className={styles.orderHead}><span><small>{order.orderCode}</small><strong>{order.customerName}</strong></span><span><Clock3 size={15} /> {time(order.scheduledFor || order.promisedAt)}</span><em>{order.fulfillmentType === "dine-in" ? order.tableLabel : order.fulfillmentType === "pickup" ? "Tự lấy" : "Giao hàng"}</em></div>
      <div>{order.items.map((item) => <section key={item.itemId} className={styles[`item_${item.itemStatus}`]}><span>{item.quantity}×</span><div><strong>{item.productName}</strong><small>{[options(item.customizationJson), item.note].filter(Boolean).join(" · ") || item.productCode}</small></div><em>{item.itemStatus === "done" ? "Đã xong" : item.itemStatus === "in_progress" ? "Đang làm" : "Chờ làm"}</em>{item.itemStatus === "pending" && canStart && <button disabled={busy === item.itemId} type="button" onClick={() => void update(item, "start")}><Play size={15} /> Bắt đầu</button>}{item.itemStatus !== "done" && canDone && <button disabled={busy === item.itemId} type="button" onClick={() => void update(item, "done")}><CheckCircle2 size={15} /> Xong</button>}</section>)}</div>
      {order.readySuggested && <p><CheckCircle2 size={17} /> Tất cả dòng món đã xong — đề xuất chuyển đơn sang “Sẵn sàng”.</p>}
    </article>)}</div>
    {!loading && !orders.length && !error && <div className={styles.empty}><ChefHat size={30} /><strong>Chưa có món tới giờ vào bếp</strong><small>Đơn đặt trước sẽ xuất hiện khi còn đúng thời gian chuẩn bị.</small></div>}
  </section>;
}
