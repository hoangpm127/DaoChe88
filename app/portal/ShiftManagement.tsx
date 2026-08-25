"use client";

import { ArrowDownToLine, Banknote, LockKeyhole, Play, Printer } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./ShiftManagement.module.css";

type Shift = {
  id: string;
  siteName: string;
  openedAt: string;
  closedAt: string | null;
  variance: number;
  status: string;
};

type ShiftManagementProps = {
  sites: Array<{ id: string; name: string }>;
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

export default function ShiftManagement({ sites, runCommand }: ShiftManagementProps) {
  const [mode, setMode] = useState<"open" | "close" | "movement">("open");
  const [siteId, setSiteId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [movementType, setMovementType] = useState("drop");
  const [busy, setBusy] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const selectedSiteId = siteId || sites[0]?.id || "";

  // Danh sách ca gần đây chỉ để lấy mã ca cho nút in. Báo cáo in tự mở cửa sổ
  // in khi tải xong, nên mở tab mới là đủ.
  const loadShifts = useCallback(async () => {
    try {
      const response = await fetch("/api/reports/shift", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return;
      const payload = await response.json() as { data?: Shift[] };
      setShifts(payload.data || []);
    } catch {
      // Không lấy được danh sách ca thì phần mở/chốt ca vẫn phải dùng được.
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadShifts());
    return () => window.cancelAnimationFrame(frame);
  }, [loadShifts]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSiteId) return;
    setBusy(true);
    const ok = mode === "open"
      ? await runCommand("shift.open", { siteId: selectedSiteId, openingCash: Number(amount), note }, "Đã mở ca và ghi nhận tiền đầu ca.")
      : mode === "close"
        ? await runCommand("shift.close", { siteId: selectedSiteId, countedCash: Number(amount), note }, "Đã chốt ca; hệ thống đã tính tiền kỳ vọng và chênh lệch.")
        : await runCommand("cash.movement.create", { siteId: selectedSiteId, movementType, amount: Number(amount), reason: note }, "Đã ghi chứng từ quỹ vào ca đang mở.");
    setBusy(false);
    if (ok) { setAmount(""); setNote(""); await loadShifts(); }
  };

  return (
    <section className={styles.shift}>
      <div className={styles.heading}><span><Banknote size={22} /></span><div><small>QUỸ CA</small><strong>Mở và chốt ca theo điểm bán</strong><p>Tiền lưu dưới dạng số nguyên VND; chênh lệch được tính ở máy chủ.</p></div></div>
      <div className={styles.modes}><button className={mode === "open" ? styles.active : ""} type="button" onClick={() => setMode("open")}><Play size={15} /> Mở ca</button><button className={mode === "close" ? styles.active : ""} type="button" onClick={() => setMode("close")}><LockKeyhole size={15} /> Chốt ca</button><button className={mode === "movement" ? styles.active : ""} type="button" onClick={() => setMode("movement")}><ArrowDownToLine size={15} /> Chứng từ quỹ</button></div>
      <form onSubmit={submit}>
        <label><span>Điểm bán</span><select required value={selectedSiteId} onChange={(event) => setSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        {mode === "movement" && <label><span>Loại chứng từ</span><select value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="drop">Rút bớt khỏi két</option><option value="float_in">Bổ sung tiền lẻ</option><option value="payout">Chi từ quỹ</option><option value="correction">Điều chỉnh</option></select></label>}
        <label><span>{mode === "open" ? "Tiền đầu ca" : mode === "close" ? "Tiền đếm thực tế" : "Số tiền chứng từ"}</span><input required min={mode === "movement" && movementType === "correction" ? undefined : "0"} step="1000" type="number" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label><span>{mode === "movement" ? "Lý do (bắt buộc)" : "Ghi chú / giải trình"}</span><input required={mode === "movement"} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button disabled={busy || !sites.length} type="submit">{busy ? "Đang xử lý…" : mode === "open" ? "Xác nhận mở ca" : mode === "close" ? "Xác nhận chốt ca" : "Ghi chứng từ"}</button>
      </form>
      <div className={styles.shiftList}>
        {shifts.map((shift) => (
          <div key={shift.id}>
            <span>
              <strong>{shift.siteName}</strong>
              <small>{shift.openedAt.slice(0, 16).replace("T", " ")} · {shift.status === "open" ? "đang mở" : `lệch ${Number(shift.variance || 0).toLocaleString("vi-VN")}đ`}</small>
            </span>
            <a href={`/api/reports/shift/${encodeURIComponent(shift.id)}`} target="_blank" rel="noreferrer">
              <Printer size={14} /> In báo cáo
            </a>
          </div>
        ))}
        {!shifts.length && <small>Chưa có ca nào trong phạm vi của bạn.</small>}
      </div>
    </section>
  );
}
