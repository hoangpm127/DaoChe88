"use client";

import { Archive, Bike, MapPinned, Plus, RefreshCw, Route, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./DeliveryManagement.module.css";

type Site = { id: string; name: string };
type Shipper = { id: string; name: string; state: string };
type Rule = {
  id: string;
  siteId: string | null;
  siteName: string | null;
  ruleType: "distance" | "order_value" | "time_window";
  minValue: number;
  maxValue: number | null;
  fee: number;
  freeOverAmount: number | null;
  priority: number;
  status: "active" | "archived";
};
type SuggestedOrder = { id: string; orderCode: string; promisedAt: string; itemCount: number; deliveryAddress: string };
type RouteSuggestion = { id: string; siteId: string; siteName: string; district: string; itemCount: number; orders: SuggestedOrder[] };
type RunCommand = (command: string, payload: Record<string, unknown>, successMessage: string) => Promise<boolean>;

const money = (value: number) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;
const ruleLabels = { distance: "Khoảng cách (m)", order_value: "Giá trị đơn (đ)", time_window: "Khung giờ (phút)" } as const;

export default function DeliveryManagement({ sites, shippers, canManageFees, canConfirmRoutes, runCommand }: {
  sites: Site[];
  shippers: Shipper[];
  canManageFees: boolean;
  canConfirmRoutes: boolean;
  runCommand: RunCommand;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [routes, setRoutes] = useState<RouteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [shipperByRoute, setShipperByRoute] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ siteId: "", ruleType: "distance", minValue: "0", maxValue: "2999", fee: "15000", freeOverAmount: "300000", priority: "0" });

  const load = useCallback(async () => {
    if (!canManageFees && !canConfirmRoutes) return;
    setLoading(true);
    setError("");
    try {
      const [feeResponse, routeResponse] = await Promise.all([
        canManageFees ? fetch("/api/deliveries/fees", { cache: "no-store", credentials: "same-origin" }) : null,
        canConfirmRoutes ? fetch("/api/deliveries/routes", { cache: "no-store", credentials: "same-origin" }) : null,
      ]);
      if (feeResponse) {
        const payload = await feeResponse.json() as { rules?: Rule[]; error?: string };
        if (!feeResponse.ok) throw new Error(payload.error || "Không tải được bảng phí giao hàng.");
        setRules(payload.rules || []);
      }
      if (routeResponse) {
        const payload = await routeResponse.json() as { suggestions?: RouteSuggestion[]; error?: string };
        if (!routeResponse.ok) throw new Error(payload.error || "Không tải được gợi ý tuyến.");
        setRoutes(payload.suggestions || []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải vận hành giao hàng.");
    } finally {
      setLoading(false);
    }
  }, [canConfirmRoutes, canManageFees]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const activeRules = useMemo(() => rules.filter((rule) => rule.status === "active"), [rules]);

  const saveRule = async () => {
    setBusy("rule");
    const ok = await runCommand("delivery-fee-rule.upsert", {
      siteId: form.siteId || null,
      ruleType: form.ruleType,
      minValue: Number(form.minValue),
      maxValue: form.maxValue === "" ? null : Number(form.maxValue),
      fee: Number(form.fee),
      freeOverAmount: form.freeOverAmount === "" ? null : Number(form.freeOverAmount),
      priority: Number(form.priority),
    }, "Đã thêm quy tắc phí giao hàng.");
    setBusy("");
    if (ok) await load();
  };

  const archiveRule = async (rule: Rule) => {
    setBusy(rule.id);
    const ok = await runCommand("delivery-fee-rule.archive", { ruleId: rule.id }, "Đã ngừng quy tắc phí giao hàng.");
    setBusy("");
    if (ok) await load();
  };

  const confirmRoute = async (suggestion: RouteSuggestion) => {
    const shipperId = shipperByRoute[suggestion.id] || "";
    if (!shipperId) return setError("Chọn shipper trước khi xác nhận tuyến.");
    setBusy(suggestion.id);
    const ok = await runCommand("delivery.route.confirm", { orderIds: suggestion.orders.map((order) => order.id), shipperId }, `Đã giao tuyến ${suggestion.orders.length} đơn.`);
    setBusy("");
    if (ok) await load();
  };

  if (!canManageFees && !canConfirmRoutes) return null;

  return <section className={styles.panel}>
    <header><span><Truck size={22} /></span><div><small>PHÍ GIAO · GOM TUYẾN · XÁC NHẬN THỦ CÔNG</small><h2>Điều phối giao hàng</h2></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="Tải lại"><RefreshCw size={18} /></button></header>
    {error && <p className={styles.error}>{error}</p>}

    {canManageFees && <div className={styles.section}>
      <div className={styles.sectionTitle}><MapPinned size={19} /><div><strong>Bảng phí theo khoảng cách</strong><small>Giá trên máy chủ được khóa vào đơn khi khách chốt.</small></div></div>
      <div className={styles.ruleForm}>
        <label>Điểm áp dụng<select value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })}><option value="">Toàn hệ thống</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label>Loại quy tắc<select value={form.ruleType} onChange={(event) => setForm({ ...form, ruleType: event.target.value })}><option value="distance">Khoảng cách</option><option value="order_value">Giá trị đơn</option><option value="time_window">Khung giờ</option></select></label>
        <label>Từ<input inputMode="numeric" value={form.minValue} onChange={(event) => setForm({ ...form, minValue: event.target.value })} /></label>
        <label>Đến<input inputMode="numeric" value={form.maxValue} onChange={(event) => setForm({ ...form, maxValue: event.target.value })} placeholder="Không giới hạn" /></label>
        <label>Phí (đ)<input inputMode="numeric" value={form.fee} onChange={(event) => setForm({ ...form, fee: event.target.value })} /></label>
        <label>Miễn phí từ<input inputMode="numeric" value={form.freeOverAmount} onChange={(event) => setForm({ ...form, freeOverAmount: event.target.value })} placeholder="Không áp dụng" /></label>
        <label>Ưu tiên<input inputMode="numeric" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} /></label>
        <button type="button" disabled={busy === "rule"} onClick={() => void saveRule()}><Plus size={17} /> {busy === "rule" ? "Đang lưu…" : "Thêm quy tắc"}</button>
      </div>
      <div className={styles.ruleList}>{activeRules.map((rule) => <article key={rule.id}><div><strong>{rule.siteName || "Toàn hệ thống"}</strong><small>{ruleLabels[rule.ruleType]} · {Number(rule.minValue).toLocaleString("vi-VN")} → {rule.maxValue === null ? "∞" : Number(rule.maxValue).toLocaleString("vi-VN")}</small></div><b>{money(rule.fee)}</b><em>{rule.freeOverAmount === null ? "Không miễn phí" : `Miễn từ ${money(rule.freeOverAmount)}`}</em><button type="button" onClick={() => void archiveRule(rule)} disabled={busy === rule.id} aria-label={`Ngừng ${rule.id}`}><Archive size={16} /></button></article>)}</div>
    </div>}

    {canConfirmRoutes && <div className={styles.section}>
      <div className={styles.sectionTitle}><Route size={19} /><div><strong>Gợi ý gom tuyến</strong><small>Cùng quận, giờ hẹn lệch dưới 20 phút và không vượt tải.</small></div></div>
      {!routes.length && <p className={styles.empty}>{loading ? "Đang tìm tuyến phù hợp…" : "Chưa có nhóm đơn nào đủ điều kiện gom tuyến."}</p>}
      <div className={styles.routeList}>{routes.map((suggestion) => <article key={suggestion.id}><div className={styles.routeMeta}><span><Bike size={18} /></span><div><strong>{suggestion.siteName} · {suggestion.district}</strong><small>{suggestion.orders.length} đơn · {suggestion.itemCount} phần</small></div></div><ul>{suggestion.orders.map((order) => <li key={order.id}><strong>{order.orderCode}</strong><span>{order.deliveryAddress}</span></li>)}</ul><div className={styles.routeAction}><select value={shipperByRoute[suggestion.id] || ""} onChange={(event) => setShipperByRoute({ ...shipperByRoute, [suggestion.id]: event.target.value })}><option value="">Chọn shipper xác nhận nhận tuyến</option>{shippers.filter((shipper) => shipper.state !== "offline").map((shipper) => <option key={shipper.id} value={shipper.id}>{shipper.name} · {shipper.state}</option>)}</select><button type="button" disabled={busy === suggestion.id} onClick={() => void confirmRoute(suggestion)}>{busy === suggestion.id ? "Đang giao…" : "Xác nhận tuyến"}</button></div></article>)}</div>
    </div>}
  </section>;
}
