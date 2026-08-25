"use client";

import { Clock3, History, Pencil, RotateCcw, Settings2, SlidersHorizontal, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./SettingsManagement.module.css";

type SettingValue = string | number | boolean | Array<string | number>;

type SettingItem = {
  key: string;
  group: string;
  label: string;
  description: string;
  type: string;
  defaultValue: SettingValue;
  currentValue: SettingValue;
  source: "default" | "global";
  min?: number;
  max?: number;
  itemMin?: number;
  itemMax?: number;
  safetyNote?: string;
  allowSiteOverride: boolean;
  canEditGlobal: boolean;
  canEditSite: boolean;
  updatedBy: string;
  updatedAt: string | null;
  siteOverrides: Array<{ siteId: string; siteName: string; value: SettingValue; updatedBy: string; updatedAt: string }>;
};

type SettingsResponse = {
  ok?: boolean;
  error?: string;
  cacheTtlSeconds?: number;
  sites?: Array<{ id: string; name: string }>;
  settings?: SettingItem[];
};

type HistoryRow = {
  id: string;
  scopeType: "global" | "site";
  scopeValue: string;
  oldValueJson: string | null;
  newValueJson: string;
  reason: string;
  changedBy: string;
  changedAt: string;
};

type Props = {
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

const groupLabels: Record<string, string> = {
  order: "Đơn hàng",
  payment: "Thanh toán",
  delivery: "Giao hàng",
  commission: "Hoa hồng",
  inventory: "Kho",
  finance: "Tài chính",
  security: "Bảo mật",
  loyalty: "Khách hàng thân thiết",
};

function valueText(value: SettingValue) {
  return Array.isArray(value) ? value.join("\n") : String(value);
}

function parseValue(setting: SettingItem, raw: string): SettingValue {
  if (["integer", "money", "percent_bps", "duration_seconds"].includes(setting.type)) return Number(raw);
  if (setting.type === "boolean") return raw === "true";
  if (setting.type === "list") {
    const values = raw.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
    return Array.isArray(setting.defaultValue) && setting.defaultValue.every((value) => typeof value === "number")
      ? values.map(Number)
      : values;
  }
  return raw.trim();
}

function displayValue(value: SettingValue, type: string) {
  if (Array.isArray(value)) return value.join(" · ");
  if (typeof value === "boolean") return value ? "Bật" : "Tắt";
  if (typeof value !== "number") return value;
  if (type === "money") return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
  if (type === "percent_bps") return `${value / 100}%`;
  if (type === "duration_seconds") {
    if (value % 86_400 === 0) return `${value / 86_400} ngày`;
    if (value % 3_600 === 0) return `${value / 3_600} giờ`;
    if (value % 60 === 0) return `${value / 60} phút`;
    return `${value} giây`;
  }
  return new Intl.NumberFormat("vi-VN").format(value);
}

function parseHistoryValue(value: string | null) {
  if (value === null) return "Chưa đặt";
  try {
    const parsed = JSON.parse(value) as SettingValue;
    return Array.isArray(parsed) ? parsed.join(" · ") : String(parsed);
  } catch {
    return value;
  }
}

export default function SettingsManagement({ runCommand }: Props) {
  const [data, setData] = useState<SettingsResponse>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ setting: SettingItem; scopeType: "global" | "site"; scopeValue: string; raw: string; reason: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<SettingItem | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json() as SettingsResponse;
      if (!response.ok) throw new Error(body.error || "Không thể tải cấu hình.");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải cấu hình.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const grouped = useMemo(() => Object.entries((data.settings || []).reduce<Record<string, SettingItem[]>>((result, setting) => {
    (result[setting.group] ||= []).push(setting);
    return result;
  }, {})), [data.settings]);

  const openEdit = (setting: SettingItem, scopeType: "global" | "site", scopeValue = "") => {
    const override = setting.siteOverrides.find((item) => item.siteId === scopeValue);
    setEditing({
      setting,
      scopeType,
      scopeValue: scopeType === "global" ? "*" : scopeValue || data.sites?.[0]?.id || "",
      raw: valueText(override?.value ?? setting.currentValue),
      reason: "",
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    const ok = await runCommand("settings.update", {
      key: editing.setting.key,
      scopeType: editing.scopeType,
      scopeValue: editing.scopeValue,
      value: parseValue(editing.setting, editing.raw),
      reason: editing.reason,
    }, `Đã cập nhật ${editing.setting.label}.`);
    setBusy(false);
    if (ok) {
      setEditing(null);
      await load();
    }
  };

  const reset = async (setting: SettingItem, scopeType: "global" | "site", scopeValue: string) => {
    if (!window.confirm(`Đưa “${setting.label}” về giá trị kế thừa?`)) return;
    setBusy(true);
    const ok = await runCommand("settings.reset", { key: setting.key, scopeType, scopeValue, reason: "Khôi phục từ giao diện quản trị" }, `Đã khôi phục ${setting.label}.`);
    setBusy(false);
    if (ok) await load();
  };

  const openHistory = async (setting: SettingItem) => {
    setHistoryFor(setting);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/settings/history?key=${encodeURIComponent(setting.key)}`, { credentials: "same-origin", cache: "no-store" });
      const body = await response.json() as { error?: string; history?: HistoryRow[] };
      if (!response.ok) throw new Error(body.error || "Không thể tải lịch sử.");
      setHistoryRows(body.history || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tải lịch sử.");
      setHistoryFor(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <section className={styles.settings}>
      <div className={styles.heading}>
        <div><small>THÔNG SỐ NGHIỆP VỤ · M14</small><h2>Cấu hình không cần deploy lại</h2><p>Giá trị theo điểm bán được ưu tiên trước toàn hệ thống và mặc định an toàn.</p></div>
        <span><SlidersHorizontal size={19} /> Cache {data.cacheTtlSeconds || 60}s</span>
      </div>

      {loading && <div className={styles.state}><Settings2 className={styles.spin} size={26} /><span>Đang tải sổ cấu hình…</span></div>}
      {error && <div className={`${styles.state} ${styles.error}`}><strong>{error}</strong><button type="button" onClick={() => void load()}>Thử lại</button></div>}
      {!loading && !error && !grouped.length && <div className={styles.state}><Settings2 size={26} /><span>Vai trò hiện tại không có thông số được phép chỉnh.</span></div>}

      <div className={styles.groups}>
        {grouped.map(([group, settings]) => <section className={styles.group} key={group}>
          <div className={styles.groupHeading}><span><Settings2 size={17} /></span><div><small>{group.toLocaleUpperCase("vi-VN")}</small><h3>{groupLabels[group] || group}</h3></div><em>{settings.length} thông số</em></div>
          <div className={styles.cards}>
            {settings.map((setting) => <article className={styles.card} key={setting.key}>
              <div className={styles.cardTop}><div><strong>{setting.label}</strong><code>{setting.key}</code></div><span className={setting.source === "global" ? styles.global : styles.fallback}>{setting.source === "global" ? "Toàn hệ thống" : "Mặc định"}</span></div>
              <p>{setting.description}</p>
              <div className={styles.value}><small>GIÁ TRỊ HIỆN TẠI</small><strong>{displayValue(setting.currentValue, setting.type)}</strong></div>
              <div className={styles.meta}><span>Mặc định: <strong>{displayValue(setting.defaultValue, setting.type)}</strong></span><span>Cập nhật: <strong>{setting.updatedBy}{setting.updatedAt ? ` · ${new Date(setting.updatedAt).toLocaleString("vi-VN")}` : ""}</strong></span></div>
              {(setting.min !== undefined || setting.max !== undefined || setting.itemMin !== undefined || setting.itemMax !== undefined) && <small className={styles.range}>Phạm vi: {setting.min ?? setting.itemMin ?? "—"} → {setting.max ?? setting.itemMax ?? "—"}</small>}
              {setting.safetyNote && <p className={styles.safety}>{setting.safetyNote}</p>}
              {!!setting.siteOverrides.length && <div className={styles.overrides}>{setting.siteOverrides.map((override) => <div key={override.siteId}><span><small>{override.siteName}</small><strong>{displayValue(override.value, setting.type)}</strong></span><button type="button" disabled={busy} onClick={() => void reset(setting, "site", override.siteId)}><RotateCcw size={14} /> Bỏ ghi đè</button></div>)}</div>}
              <footer>
                <button type="button" onClick={() => void openHistory(setting)}><History size={15} /> Lịch sử</button>
                {setting.source === "global" && setting.canEditGlobal && <button type="button" disabled={busy} onClick={() => void reset(setting, "global", "*")}><RotateCcw size={15} /> Mặc định</button>}
                {setting.canEditSite && <button type="button" onClick={() => openEdit(setting, "site")}><Pencil size={15} /> Theo điểm</button>}
                {setting.canEditGlobal && <button className={styles.primary} type="button" onClick={() => openEdit(setting, "global", "*")}><Pencil size={15} /> Chỉnh</button>}
              </footer>
            </article>)}
          </div>
        </section>)}
      </div>

      {editing && <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setEditing(null)}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="setting-edit-title">
          <button className={styles.close} type="button" aria-label="Đóng" onClick={() => setEditing(null)}><X size={18} /></button>
          <span className={styles.dialogIcon}><SlidersHorizontal size={23} /></span><small>{editing.scopeType === "global" ? "TOÀN HỆ THỐNG" : "GHI ĐÈ THEO ĐIỂM"}</small>
          <h3 id="setting-edit-title">{editing.setting.label}</h3><p>{editing.setting.description}</p>
          <form onSubmit={submit}>
            {editing.scopeType === "site" && <label><span>Điểm bán</span><select required value={editing.scopeValue} onChange={(event) => {
              const scopeValue = event.target.value;
              const override = editing.setting.siteOverrides.find((item) => item.siteId === scopeValue);
              setEditing({ ...editing, scopeValue, raw: valueText(override?.value ?? editing.setting.currentValue) });
            }}>{(data.sites || []).map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>}
            <label><span>Giá trị {editing.setting.type === "list" ? "(mỗi dòng một mục)" : ""}</span>
              {editing.setting.type === "boolean"
                ? <select value={editing.raw} onChange={(event) => setEditing({ ...editing, raw: event.target.value })}><option value="true">Bật</option><option value="false">Tắt</option></select>
                : editing.setting.type === "list"
                  ? <textarea required rows={7} value={editing.raw} onChange={(event) => setEditing({ ...editing, raw: event.target.value })} />
                  : <input required type={["integer", "money", "percent_bps", "duration_seconds"].includes(editing.setting.type) ? "number" : "text"} min={editing.setting.min} max={editing.setting.max} value={editing.raw} onChange={(event) => setEditing({ ...editing, raw: event.target.value })} />}
            </label>
            <label><span>Lý do thay đổi</span><textarea maxLength={500} rows={3} placeholder="Ví dụ: áp dụng chính sách tháng 9" value={editing.reason} onChange={(event) => setEditing({ ...editing, reason: event.target.value })} /></label>
            {editing.setting.safetyNote && <p className={styles.safety}>{editing.setting.safetyNote}</p>}
            <button className={styles.submit} disabled={busy || (editing.scopeType === "site" && !editing.scopeValue)} type="submit">{busy ? "Đang lưu…" : "Lưu cấu hình"}</button>
          </form>
        </section>
      </div>}

      {historyFor && <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setHistoryFor(null)}>
        <section className={`${styles.dialog} ${styles.historyDialog}`} role="dialog" aria-modal="true" aria-labelledby="setting-history-title">
          <button className={styles.close} type="button" aria-label="Đóng" onClick={() => setHistoryFor(null)}><X size={18} /></button>
          <span className={styles.dialogIcon}><History size={23} /></span><small>LỊCH SỬ BẤT BIẾN</small><h3 id="setting-history-title">{historyFor.label}</h3>
          {historyLoading && <div className={styles.state}><Clock3 size={21} /> Đang tải…</div>}
          {!historyLoading && !historyRows.length && <div className={styles.state}>Chưa có lần thay đổi nào.</div>}
          <div className={styles.timeline}>{historyRows.map((row) => <article key={row.id}><span /><div><strong>{parseHistoryValue(row.oldValueJson)} → {parseHistoryValue(row.newValueJson)}</strong><small>{row.scopeType === "global" ? "Toàn hệ thống" : (data.sites || []).find((site) => site.id === row.scopeValue)?.name || row.scopeValue}</small><p>{row.reason || "Không ghi lý do"}</p></div><em>{row.changedBy}<br />{new Date(row.changedAt).toLocaleString("vi-VN")}</em></article>)}</div>
        </section>
      </div>}
    </section>
  );
}
