"use client";

import { Camera, CheckCircle2, LocateFixed, PackageCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./ShipperDeliveryPanel.module.css";

type DeliveryStatus = "assigned" | "picked_up" | "delivering";
type RunCommand = (command: string, payload: Record<string, unknown>, successMessage: string) => Promise<boolean>;

async function compressDeliveryPhoto(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Chỉ nhận tệp ảnh.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Trình duyệt không thể xử lý ảnh.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
  if (!blob) throw new Error("Không thể nén ảnh bằng chứng.");
  return new File([blob], `pod-${Date.now()}.jpg`, { type: "image/jpeg" });
}

function browserLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Thiết bị không hỗ trợ GPS."));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 });
  });
}

export default function ShipperDeliveryPanel({ orderId, status, runCommand, onCompleted }: {
  orderId: string;
  status: DeliveryStatus;
  runCommand: RunCommand;
  onCompleted: () => void;
}) {
  const [mode, setMode] = useState<"normal" | "delivered" | "failed">("normal");
  const [otp, setOtp] = useState("");
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [location, setLocation] = useState<{ latitudeE6: number; longitudeE6: number; accuracyM: number } | null>(null);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const readLocation = async (send = false) => {
    setBusy("location");
    setError("");
    try {
      const position = await browserLocation();
      const point = {
        latitudeE6: Math.round(position.coords.latitude * 1_000_000),
        longitudeE6: Math.round(position.coords.longitude * 1_000_000),
        accuracyM: Math.round(position.coords.accuracy),
      };
      setLocation(point);
      if (send) {
        const response = await fetch("/api/shipper/location", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, ...point }) });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Không gửi được vị trí.");
      }
      return point;
    } catch (cause) {
      const message = cause instanceof GeolocationPositionError && cause.code === cause.PERMISSION_DENIED ? "Bạn cần cấp quyền vị trí cho trình duyệt." : cause instanceof Error ? cause.message : "Không đọc được vị trí.";
      setError(message);
      return null;
    } finally {
      setBusy("");
    }
  };

  const uploadProof = async (purpose: "delivered" | "delivery_failed") => {
    if (!photo) return null;
    const compressed = await compressDeliveryPhoto(photo);
    const point = location || await readLocation(false);
    const form = new FormData();
    form.set("orderId", orderId);
    form.set("purpose", purpose);
    form.set("file", compressed);
    if (point) {
      form.set("latitudeE6", String(point.latitudeE6));
      form.set("longitudeE6", String(point.longitudeE6));
    }
    const response = await fetch("/api/deliveries/proof", { method: "POST", credentials: "same-origin", body: form });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Không tải được ảnh bằng chứng.");
    return payload;
  };

  const advance = async () => {
    setError("");
    if (status === "assigned") {
      setBusy("advance");
      const ok = await runCommand("order.advance", { orderId, nextStatus: "picked_up", status: "picked_up", note: "Shipper đã quét nhận túi" }, "Đã xác nhận nhận túi.");
      setBusy("");
      if (ok) onCompleted();
      return;
    }
    if (status === "picked_up" && mode === "normal") {
      setBusy("advance");
      const ok = await runCommand("order.advance", { orderId, nextStatus: "delivering", status: "delivering", note: "Shipper bắt đầu giao" }, "Đã bắt đầu giao đơn.");
      setBusy("");
      if (ok) onCompleted();
      return;
    }
    const purpose = mode === "failed" ? "delivery_failed" : "delivered";
    if (purpose === "delivery_failed" && reason.trim().length < 3) return setError("Nhập lý do giao thất bại.");
    if (purpose === "delivery_failed" && !photo) return setError("Giao thất bại bắt buộc có ảnh bằng chứng.");
    if (purpose === "delivered" && !photo && !/^\d{4}$/.test(otp)) return setError("Nhập OTP 4 số của khách hoặc chụp ảnh POD.");
    setBusy("complete");
    try {
      if (photo) await uploadProof(purpose);
      const ok = await runCommand("order.advance", {
        orderId,
        nextStatus: purpose,
        status: purpose,
        deliveryOtp: otp,
        reason: purpose === "delivery_failed" ? reason : undefined,
        note: purpose === "delivery_failed" ? reason : "Khách đã nhận và xác nhận POD",
      }, purpose === "delivered" ? "Đã hoàn tất giao đơn." : "Đã ghi nhận giao thất bại.");
      if (ok) onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể hoàn tất giao hàng.");
    } finally {
      setBusy("");
    }
  };

  const activeTravel = status === "picked_up" || status === "delivering";
  useEffect(() => {
    if (!activeTravel || !sharingLocation || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition((position) => {
      const point = { latitudeE6: Math.round(position.coords.latitude * 1_000_000), longitudeE6: Math.round(position.coords.longitude * 1_000_000), accuracyM: Math.round(position.coords.accuracy) };
      setLocation(point);
      void fetch("/api/shipper/location", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, ...point }) })
        .then(async (response) => { if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "Không gửi được vị trí."); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Không gửi được vị trí."));
    }, (cause) => setError(cause.code === cause.PERMISSION_DENIED ? "Bạn cần cấp quyền vị trí cho trình duyệt." : "Không đọc được vị trí."), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeTravel, orderId, sharingLocation]);
  const completionMode = status === "delivering" || mode === "failed";
  return <div className={styles.panel}>
    {activeTravel && <button className={styles.location} type="button" disabled={Boolean(busy)} onClick={() => setSharingLocation((value) => !value)}><LocateFixed size={18} /> {sharingLocation ? "Dừng chia sẻ vị trí" : "Bật chia sẻ vị trí định kỳ"}</button>}
    {!completionMode && <button className={styles.primary} type="button" disabled={Boolean(busy)} onClick={() => void advance()}><PackageCheck size={18} /> {status === "assigned" ? "Quét nhận túi" : "Bắt đầu giao"}</button>}
    {status === "delivering" && mode === "normal" && <div className={styles.choices}><button type="button" onClick={() => setMode("delivered")}><CheckCircle2 size={18} /> Giao thành công</button><button type="button" onClick={() => setMode("failed")}><TriangleAlert size={18} /> Giao thất bại</button></div>}
    {status === "picked_up" && mode === "normal" && <button className={styles.failureLink} type="button" onClick={() => setMode("failed")}>Không thể giao đơn này</button>}
    {completionMode && <div className={styles.form}>
      <strong>{mode === "failed" ? "Báo giao thất bại" : "Bằng chứng giao thành công"}</strong>
      {mode === "delivered" && <label>OTP 4 số của khách<input inputMode="numeric" maxLength={4} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" /></label>}
      {mode === "failed" && <label>Lý do<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: khách không nghe máy, địa chỉ đóng cửa…" /></label>}
      <label className={styles.photo}><Camera size={18} /> {photo ? photo.name : mode === "failed" ? "Chụp ảnh bắt buộc" : "Chụp ảnh POD thay OTP"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setPhoto(event.target.files?.[0] || null)} /></label>
      <div><button type="button" onClick={() => { setMode("normal"); setError(""); }}>Quay lại</button><button type="button" disabled={Boolean(busy)} onClick={() => void advance()}>{busy === "complete" ? "Đang lưu…" : "Xác nhận"}</button></div>
    </div>}
    {location && <small>GPS gần nhất: {(location.latitudeE6 / 1_000_000).toFixed(6)}, {(location.longitudeE6 / 1_000_000).toFixed(6)} · ±{location.accuracyM}m</small>}
    {error && <p>{error}</p>}
  </div>;
}
