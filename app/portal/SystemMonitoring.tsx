"use client";

/**
 * Bảng giám sát hệ thống (M13).
 *
 * Đọc số liệu mà healthcheck đã tính sẵn: sự cố đang mở, lưu lượng request và
 * độ trễ trong một giờ gần nhất, khối lượng đơn, số kết nối realtime.
 *
 * Backend có từ trước nhưng chưa màn hình nào gọi tới, nên chủ hệ thống không có
 * chỗ nào nhìn thấy hệ thống đang khoẻ hay đang hỏng ngoài việc tự gọi API.
 *
 * CHỈ ba vai trò được xem (owner, super-admin, control) — máy chủ chốt việc đó.
 * Vai trò khác nhận 403 và màn hình nói thẳng, không hiện số 0 như thể đã kiểm
 * và hệ thống sạch sẽ.
 */

import { Activity, AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import styles from "./SystemMonitoring.module.css";

type Incident = {
  incidentKey: string;
  category: string;
  severity: string;
  title: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Summary = {
  since: string;
  incidents: Incident[];
  requests: {
    requestCount: number;
    requestsPerMinute: number;
    errorCount: number;
    errorRate: number;
    averageMs: number;
    p95Ms: number;
    maximumMs: number;
  };
  operations: { orderCount: number; deliveredRevenue: number; activeOrders: number } | null;
  activeStreamConnections: number;
};

function ms(value: number) {
  return `${Math.round(Number(value || 0))}ms`;
}

function percent(value: number) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function timeOf(value: string) {
  return String(value || "").slice(11, 16) || "—";
}

export default function SystemMonitoring() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/monitoring/summary", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        setSummary(null);
        return;
      }
      const payload = await response.json() as { summary?: Summary };
      if (response.ok && payload.summary) {
        setForbidden(false);
        setSummary(payload.summary);
      }
    } catch {
      // Giữ số liệu lần trước thay vì xoá trắng màn hình.
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    // Làm mới mỗi phút: số liệu tính trên cửa sổ một giờ nên không cần dày hơn.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [load]);

  if (forbidden) {
    return (
      <section className={styles.panel}>
        <div className={styles.heading}>
          <span><Activity size={22} /></span>
          <div>
            <small>GIÁM SÁT HỆ THỐNG</small>
            <strong>Vai trò hiện tại không được xem</strong>
            <p>Bảng giám sát dành cho chủ hệ thống và kiểm soát nội bộ.</p>
          </div>
        </div>
      </section>
    );
  }

  const requests = summary?.requests;
  const healthy = summary ? summary.incidents.length === 0 : false;

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span className={healthy ? styles.iconOk : styles.iconWarn}>
          {healthy ? <ShieldCheck size={22} /> : <Activity size={22} />}
        </span>
        <div>
          <small>GIÁM SÁT HỆ THỐNG</small>
          <strong>{summary ? (healthy ? "Không có sự cố đang mở" : `${summary.incidents.length} sự cố đang mở`) : "Đang tải…"}</strong>
          <p>Số liệu tính trên một giờ gần nhất{summary ? `, từ ${timeOf(summary.since)}` : ""}.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Làm mới bảng giám sát">
          <RefreshCw size={15} />
        </button>
      </div>

      {summary && (
        <>
          <div className={styles.metrics}>
            <article>
              <small>Request / phút</small>
              <strong>{requests!.requestsPerMinute.toFixed(1)}</strong>
              <em>{requests!.requestCount} request trong giờ</em>
            </article>
            <article className={requests!.errorRate > 0.01 ? styles.bad : ""}>
              <small>Tỷ lệ lỗi</small>
              <strong>{percent(requests!.errorRate)}</strong>
              <em>{requests!.errorCount} lỗi máy chủ</em>
            </article>
            <article className={requests!.p95Ms > 300 ? styles.bad : ""}>
              <small>Độ trễ p95</small>
              <strong>{ms(requests!.p95Ms)}</strong>
              {/* Ngưỡng 300ms là mốc đã dùng khi nghiệm thu tải ở M12. */}
              <em>trung bình {ms(requests!.averageMs)} · đỉnh {ms(requests!.maximumMs)}</em>
            </article>
            <article>
              <small>Đơn đang chạy</small>
              <strong>{summary.operations?.activeOrders ?? 0}</strong>
              <em>{summary.operations?.orderCount ?? 0} đơn mới · {summary.activeStreamConnections} kết nối realtime</em>
            </article>
          </div>

          <h3>Sự cố đang mở</h3>
          <div className={styles.incidents}>
            {summary.incidents.map((incident) => (
              <div key={incident.incidentKey} className={incident.severity === "critical" ? styles.critical : styles.warning}>
                <span><AlertTriangle size={16} /></span>
                <div>
                  <strong>{incident.title}</strong>
                  <small>{incident.category} · lặp {incident.occurrenceCount} lần · gần nhất {timeOf(incident.lastSeenAt)}</small>
                </div>
                <em>{incident.severity}</em>
              </div>
            ))}
            {!summary.incidents.length && (
              <p className={styles.clear}><ShieldCheck size={16} /> Không có sự cố nào đang mở.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
