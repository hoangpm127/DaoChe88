"use client";

import { CalendarClock, ChevronRight, MapPin, Plus, Store, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import HanoiLocationPicker, { isHanoiCoordinate } from "../components/HanoiLocationPicker";
import styles from "./NetworkManagement.module.css";

export type NetworkSiteSummary = {
  id: string;
  name: string;
  type: string;
  status: string;
  address: string;
  district: string;
  manager: string;
  phone: string;
  capacity: number;
  latitudeE6: number | null;
  longitudeE6: number | null;
  openingHoursJson: string;
  serviceRadiusM: number;
};

type NetworkManagementProps = {
  sites: NetworkSiteSummary[];
  canCreate: boolean;
  canUpdate: boolean;
  canManageCoordinates: boolean;
  runCommand: (command: string, data: Record<string, unknown>, successMessage: string) => Promise<boolean>;
};

const allDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function NetworkManagement({ sites, canCreate, canUpdate, canManageCoordinates, runCommand }: NetworkManagementProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<NetworkSiteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [coordinateError, setCoordinateError] = useState("");
  const [edit, setEdit] = useState({
    name: "",
    address: "",
    district: "",
    managerName: "",
    phone: "",
    latitude: "",
    longitude: "",
    openingHoursJson: "{}",
    serviceRadiusM: "5000",
    capacityPerHour: "",
  });
  const [closure, setClosure] = useState({ reason: "", startsAt: "", endsAt: "" });
  const [form, setForm] = useState({
    name: "",
    code: "",
    kind: "official-store",
    address: "",
    district: "",
    managerName: "",
    phone: "",
    latitude: "",
    longitude: "",
    serviceRadiusM: "5000",
    capacityPerHour: "",
    opensAt: "06:30",
    closesAt: "22:00",
  });

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (!isHanoiCoordinate(latitude, longitude)) {
      setCoordinateError("Hãy chọn chính xác vị trí điểm bán trên bản đồ Hà Nội.");
      return;
    }
    setBusy(true);
    const hours = Object.fromEntries(allDays.map((day) => [day, [[form.opensAt, form.closesAt]]]));
    const ok = await runCommand("site.create", {
      ...form,
      latitude,
      longitude,
      serviceRadiusM: Number(form.serviceRadiusM),
      capacityPerHour: Number(form.capacityPerHour || 0),
      openingHours: hours,
      fulfillment: ["delivery", "pickup"],
    }, `${form.name} đã được tạo và sẽ xuất hiện trên ứng dụng khách.`);
    setBusy(false);
    if (ok) {
      setCoordinateError("");
      setShowCreate(false);
      setForm((current) => ({ ...current, name: "", code: "", address: "", district: "", managerName: "", phone: "", latitude: "", longitude: "", serviceRadiusM: "5000", capacityPerHour: "" }));
    }
  };

  const setStatus = async (site: NetworkSiteSummary, status: "open" | "temporarily_closed") => {
    setBusy(true);
    const ok = await runCommand("site.set-status", { siteId: site.id, status, reason: status === "open" ? "Mở lại từ giao diện quản trị" : "Tạm đóng từ giao diện quản trị" }, status === "open" ? `${site.name} đã mở lại.` : `${site.name} đã tạm đóng.`);
    setBusy(false);
    if (ok) setSelected(null);
  };

  const openSite = (site: NetworkSiteSummary) => {
    setCoordinateError("");
    setSelected(site);
    setEdit({
      name: site.name,
      address: site.address,
      district: site.district,
      managerName: site.manager,
      phone: site.phone,
      latitude: site.latitudeE6 === null ? "" : String(site.latitudeE6 / 1_000_000),
      longitude: site.longitudeE6 === null ? "" : String(site.longitudeE6 / 1_000_000),
      openingHoursJson: site.openingHoursJson || "{}",
      serviceRadiusM: String(site.serviceRadiusM || 5000),
      capacityPerHour: String(site.capacity || 0),
    });
    setClosure({ reason: "", startsAt: "", endsAt: "" });
  };

  const submitUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const latitude = edit.latitude.trim() ? Number(edit.latitude) : null;
    const longitude = edit.longitude.trim() ? Number(edit.longitude) : null;
    if (canManageCoordinates && !isHanoiCoordinate(latitude, longitude)) {
      setCoordinateError("Hãy chọn chính xác vị trí điểm bán trên bản đồ Hà Nội.");
      return;
    }
    const editableFields: Record<string, unknown> = { ...edit };
    delete editableFields.latitude;
    delete editableFields.longitude;
    setBusy(true);
    const ok = await runCommand("site.update", {
      siteId: selected.id,
      ...editableFields,
      ...(canManageCoordinates ? { latitude, longitude } : {}),
      serviceRadiusM: Number(edit.serviceRadiusM),
      capacityPerHour: Number(edit.capacityPerHour || 0),
    }, `${edit.name} đã được cập nhật.`);
    setBusy(false);
    if (ok) {
      setCoordinateError("");
      setSelected(null);
    }
  };

  const submitClosure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const ok = await runCommand("site.closure.add", {
      siteId: selected.id,
      reason: closure.reason,
      startsAt: new Date(closure.startsAt).toISOString(),
      endsAt: closure.endsAt ? new Date(closure.endsAt).toISOString() : undefined,
    }, `Đã thêm lịch đóng cửa cho ${selected.name}.`);
    setBusy(false);
    if (ok) setSelected(null);
  };

  return (
    <section className={styles.network}>
      <div className={styles.heading}>
        <div><small>MASTER DATA MẠNG LƯỚI</small><h2>Điểm bán lấy trực tiếp từ cơ sở dữ liệu</h2><p>Tạo điểm mới, cập nhật trạng thái và lịch vận hành mà không cần deploy.</p></div>
        {canCreate && <button type="button" onClick={() => { setCoordinateError(""); setShowCreate(true); }}><Plus size={18} /> Thêm điểm bán</button>}
      </div>
      <div className={styles.grid}>
        {sites.map((site) => (
          <button type="button" key={site.id} onClick={() => openSite(site)}>
            <span className={site.status === "open" ? styles.open : ""}><Store size={21} /></span>
            <div><strong>{site.name}</strong><small>{site.address || "Chưa cập nhật địa chỉ"}</small></div>
            <em>{site.status === "open" ? "Đang mở" : site.status === "temporarily_closed" ? "Tạm đóng" : "Đã đóng"}</em>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      {!sites.length && <div className={styles.empty}><MapPin size={28} /><strong>Chưa có điểm bán trong phạm vi phiên</strong><span>Owner có thể tạo điểm đầu tiên từ nút “Thêm điểm bán”.</span></div>}

      {selected && <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setSelected(null)}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="network-site-title">
          <button className={styles.close} type="button" aria-label="Đóng" onClick={() => setSelected(null)}><X size={19} /></button>
          <span className={styles.dialogIcon}><Store size={25} /></span>
          <small>{selected.type}</small><h3 id="network-site-title">{selected.name}</h3><p>{selected.address}</p>
          <dl><div><dt>Quản lý</dt><dd>{selected.manager || "Chưa gán"}</dd></div><div><dt>Năng lực</dt><dd>{selected.capacity || 0} phần/giờ</dd></div></dl>
          {canUpdate && <>
            <form className={styles.editForm} onSubmit={submitUpdate}>
              <strong>Cập nhật thông tin</strong>
              <label><span>Tên điểm bán</span><input required maxLength={120} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
              <label><span>Địa chỉ</span><input required maxLength={300} value={edit.address} onChange={(event) => setEdit({ ...edit, address: event.target.value })} /></label>
              <div><label><span>Quận/huyện</span><input required maxLength={100} value={edit.district} onChange={(event) => setEdit({ ...edit, district: event.target.value })} /></label><label><span>Số điện thoại</span><input inputMode="tel" value={edit.phone} onChange={(event) => setEdit({ ...edit, phone: event.target.value })} /></label></div>
              <HanoiLocationPicker
                latitude={edit.latitude.trim() ? Number(edit.latitude) : null}
                longitude={edit.longitude.trim() ? Number(edit.longitude) : null}
                disabled={!canManageCoordinates}
                label={canManageCoordinates ? "Ghim vị trí điểm bán" : "Vị trí do Admin tổng quản lý"}
                onChange={(latitude, longitude) => {
                  setCoordinateError("");
                  setEdit((current) => ({ ...current, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }));
                }}
              />
              <div><label><span>Vĩ độ</span><input disabled={!canManageCoordinates} required={canManageCoordinates} type="number" step="0.000001" min="20.5" max="21.5" value={edit.latitude} onChange={(event) => { setCoordinateError(""); setEdit({ ...edit, latitude: event.target.value }); }} /></label><label><span>Kinh độ</span><input disabled={!canManageCoordinates} required={canManageCoordinates} type="number" step="0.000001" min="105.2" max="106.2" value={edit.longitude} onChange={(event) => { setCoordinateError(""); setEdit({ ...edit, longitude: event.target.value }); }} /></label></div>
              {coordinateError && <p className={styles.coordinateError} role="alert">{coordinateError}</p>}
              <label><span>Lịch mở cửa (JSON theo mon…sun)</span><textarea required rows={4} value={edit.openingHoursJson} onChange={(event) => setEdit({ ...edit, openingHoursJson: event.target.value })} /></label>
              <div><label><span>Bán kính phục vụ (m)</span><input required min="100" max="100000" type="number" value={edit.serviceRadiusM} onChange={(event) => setEdit({ ...edit, serviceRadiusM: event.target.value })} /></label><label><span>Năng lực/giờ</span><input min="0" type="number" value={edit.capacityPerHour} onChange={(event) => setEdit({ ...edit, capacityPerHour: event.target.value })} /></label></div>
              <label><span>Quản lý</span><input maxLength={120} value={edit.managerName} onChange={(event) => setEdit({ ...edit, managerName: event.target.value })} /></label>
              <button className={styles.submit} disabled={busy} type="submit">Lưu thay đổi</button>
            </form>
            <form className={styles.editForm} onSubmit={submitClosure}>
              <strong>Lên lịch nghỉ/sửa chữa</strong>
              <label><span>Lý do</span><input required maxLength={300} value={closure.reason} onChange={(event) => setClosure({ ...closure, reason: event.target.value })} /></label>
              <div><label><span>Bắt đầu</span><input required type="datetime-local" value={closure.startsAt} onChange={(event) => setClosure({ ...closure, startsAt: event.target.value })} /></label><label><span>Kết thúc (tùy chọn)</span><input type="datetime-local" value={closure.endsAt} onChange={(event) => setClosure({ ...closure, endsAt: event.target.value })} /></label></div>
              <button className={styles.submit} disabled={busy} type="submit">Thêm lịch đóng cửa</button>
            </form>
            <div className={styles.actions}>
              {selected.status === "open"
                ? <button type="button" disabled={busy} onClick={() => void setStatus(selected, "temporarily_closed")}><CalendarClock size={17} /> Tạm đóng ngay</button>
                : <button type="button" disabled={busy} onClick={() => void setStatus(selected, "open")}><Store size={17} /> Mở lại</button>}
            </div>
          </>}
        </section>
      </div>}

      {showCreate && <div className={styles.backdrop} onClick={(event) => event.target === event.currentTarget && setShowCreate(false)}>
        <section className={`${styles.dialog} ${styles.createDialog}`} role="dialog" aria-modal="true" aria-labelledby="network-create-title">
          <button className={styles.close} type="button" aria-label="Đóng" onClick={() => setShowCreate(false)}><X size={19} /></button>
          <small>ĐIỂM BÁN MỚI</small><h3 id="network-create-title">Thêm vào mạng lưới</h3>
          <form onSubmit={submitCreate}>
            <label><span>Tên điểm bán</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <div><label><span>Mã (có thể để trống)</span><input maxLength={40} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label><label><span>Loại điểm</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}><option value="official-store">Cửa hàng chính thống</option><option value="official-express">Điểm Express</option><option value="partner-counter">Điểm đối tác</option><option value="central-kitchen">Bếp tổng</option></select></label></div>
            <label><span>Địa chỉ thật</span><input required maxLength={300} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
            <div><label><span>Quận/huyện</span><input required maxLength={100} value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} /></label><label><span>Quản lý</span><input maxLength={120} value={form.managerName} onChange={(event) => setForm({ ...form, managerName: event.target.value })} /></label></div>
            <HanoiLocationPicker
              latitude={form.latitude.trim() ? Number(form.latitude) : null}
              longitude={form.longitude.trim() ? Number(form.longitude) : null}
              label="Ghim vị trí điểm bán mới"
              onChange={(latitude, longitude) => {
                setCoordinateError("");
                setForm((current) => ({ ...current, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }));
              }}
            />
            <div><label><span>Vĩ độ</span><input required type="number" step="0.000001" min="20.5" max="21.5" value={form.latitude} onChange={(event) => { setCoordinateError(""); setForm({ ...form, latitude: event.target.value }); }} /></label><label><span>Kinh độ</span><input required type="number" step="0.000001" min="105.2" max="106.2" value={form.longitude} onChange={(event) => { setCoordinateError(""); setForm({ ...form, longitude: event.target.value }); }} /></label></div>
            {coordinateError && <p className={styles.coordinateError} role="alert">{coordinateError}</p>}
            <div><label><span>Mở cửa</span><input required type="time" value={form.opensAt} onChange={(event) => setForm({ ...form, opensAt: event.target.value })} /></label><label><span>Đóng cửa</span><input required type="time" value={form.closesAt} onChange={(event) => setForm({ ...form, closesAt: event.target.value })} /></label></div>
            <div><label><span>Số điện thoại</span><input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label><span>Bán kính phục vụ (m)</span><input required min="100" max="100000" type="number" value={form.serviceRadiusM} onChange={(event) => setForm({ ...form, serviceRadiusM: event.target.value })} /></label></div>
            <label><span>Năng lực/giờ</span><input min="0" type="number" value={form.capacityPerHour} onChange={(event) => setForm({ ...form, capacityPerHour: event.target.value })} /></label>
            <button className={styles.submit} disabled={busy} type="submit">{busy ? "Đang tạo…" : "Tạo điểm bán"}</button>
          </form>
        </section>
      </div>}
    </section>
  );
}
