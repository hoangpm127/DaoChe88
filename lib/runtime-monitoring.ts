import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { envValue } from "./config.ts";
import { queryRows } from "./operations-sql.ts";

type Incident = {
  key: string;
  category: string;
  severity: "warning" | "critical";
  title: string;
  count: number;
  detail?: Record<string, unknown>;
};

function safeError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***").slice(0, 2_000);
}

async function postAlert(payload: Record<string, unknown>) {
  const url = envValue("OPERATIONS_ALERT_WEBHOOK_URL");
  if (!url) return { sent: false, reason: "not_configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { sent: response.ok, status: response.status };
  } catch (error) {
    console.error("Không thể gửi cảnh báo vận hành.", safeError(error));
    return { sent: false, reason: "request_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function reportRuntimeError(error: unknown, context: Record<string, unknown> = {}) {
  const payload = {
    source: "taopho88",
    severity: "critical",
    title: "Runtime request error",
    error: safeError(error),
    context,
    occurredAt: new Date().toISOString(),
  };
  console.error(JSON.stringify(payload));
  return postAlert(payload);
}

async function upsertIncident(database: RuntimeDatabase, incident: Incident, now: string) {
  await database.prepare(`INSERT INTO monitor_incidents
      (incident_key, category, severity, title, detail_json, status, occurrence_count, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, 'open', 1, ?, ?)
    ON CONFLICT (incident_key) DO UPDATE SET
      category = excluded.category, severity = excluded.severity, title = excluded.title,
      detail_json = excluded.detail_json, status = 'open', resolved_at = NULL,
      occurrence_count = monitor_incidents.occurrence_count + 1, last_seen_at = excluded.last_seen_at`)
    .bind(incident.key, incident.category, incident.severity, incident.title, JSON.stringify({ count: incident.count, ...incident.detail }), now, now)
    .run();
  const notifyBefore = new Date(new Date(now).getTime() - 10 * 60_000).toISOString();
  const claimed = await database.prepare(`UPDATE monitor_incidents SET notified_at = ?
    WHERE incident_key = ? AND (notified_at IS NULL OR notified_at < ?) RETURNING incident_key`)
    .bind(now, incident.key, notifyBefore).all();
  if (claimed.results.length) await postAlert({
    source: "taopho88",
    severity: incident.severity,
    title: incident.title,
    category: incident.category,
    count: incident.count,
    detail: incident.detail || {},
    occurredAt: now,
  });
}

async function count(database: RuntimeDatabase, sql: string, values: Array<string | number> = []) {
  return Number(await database.prepare(sql).bind(...values).first("count")) || 0;
}

export async function runOperationalChecks(database: RuntimeDatabase, now = new Date()) {
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const [sepayFailures, stuckOrders, invalidStock, cashVariance, debtLimit, overdueReconciliation] = await Promise.all([
    count(database, "SELECT COUNT(*) AS count FROM payment_attempts WHERE provider = 'sepay' AND status = 'failed' AND updated_at >= ?", [tenMinutesAgo]),
    count(database, "SELECT COUNT(*) AS count FROM operation_orders WHERE order_status = 'new' AND created_at <= ?", [fifteenMinutesAgo]),
    count(database, `SELECT
      (SELECT COUNT(*) FROM catalog_site_stock WHERE track_stock = 1 AND (on_hand < 0 OR reserved < 0 OR reserved > on_hand))
      + (SELECT COUNT(*) FROM operation_inventory WHERE on_hand < 0 OR reserved < 0 OR reserved > on_hand) AS count`),
    count(database, "SELECT COUNT(*) AS count FROM work_shifts WHERE status = 'closed' AND ABS(COALESCE(variance, 0)) >= 20000 AND closed_at >= ?", [oneDayAgo]),
    count(database, "SELECT COUNT(*) AS count FROM internal_accounts WHERE credit_limit > 0 AND balance > credit_limit"),
    count(database, "SELECT COUNT(*) AS count FROM bank_reconciliations WHERE status = 'open' AND created_at <= ?", [oneDayAgo]),
  ]);
  const candidates: Incident[] = [
    { key: "sepay-failures", category: "payment", severity: "critical", title: "SePay lỗi quá 3 lần trong 10 phút", count: sepayFailures },
    { key: "orders-stuck-new", category: "orders", severity: "critical", title: "Đơn mới chưa nhận quá 15 phút", count: stuckOrders },
    { key: "invalid-stock", category: "inventory", severity: "critical", title: "Tồn kho có trạng thái không hợp lệ", count: invalidStock },
    { key: "cash-variance", category: "finance", severity: "warning", title: "Ca có chênh lệch quỹ đáng kể", count: cashVariance },
    { key: "debt-limit", category: "finance", severity: "critical", title: "Công nợ vượt hạn mức", count: debtLimit },
    { key: "reconciliation-overdue", category: "finance", severity: "warning", title: "Đối soát ngân hàng quá hạn", count: overdueReconciliation },
  ];
  const active = candidates.filter((entry) => entry.count > (entry.key === "sepay-failures" ? 3 : 0));
  const nowIso = now.toISOString();
  for (const incident of active) await upsertIncident(database, incident, nowIso);
  const activeKeys = new Set(active.map((entry) => entry.key));
  for (const candidate of candidates) {
    if (!activeKeys.has(candidate.key)) {
      await database.prepare("UPDATE monitor_incidents SET status = 'resolved', resolved_at = ? WHERE incident_key = ? AND status = 'open'")
        .bind(nowIso, candidate.key).run();
    }
  }
  return { ok: active.every((entry) => entry.severity !== "critical"), counts: { sepayFailures, stuckOrders, invalidStock, cashVariance, debtLimit, overdueReconciliation }, active: active.map((entry) => entry.key) };
}

export async function monitoringSummary(database: RuntimeDatabase) {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const [incidents, requestRows, operations, connections] = await Promise.all([
    queryRows<Record<string, unknown>>(database.prepare("SELECT * FROM monitor_incidents WHERE status = 'open' ORDER BY severity DESC, last_seen_at DESC")),
    queryRows<{ durationMs: number; statusCode: number }>(database.prepare("SELECT duration_ms, status_code FROM application_request_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT 10000").bind(since)),
    database.prepare(`SELECT COUNT(*) AS order_count,
      COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN total_amount ELSE 0 END), 0) AS delivered_revenue,
      COALESCE(SUM(CASE WHEN order_status NOT IN ('delivered','cancelled') THEN 1 ELSE 0 END), 0) AS active_orders
      FROM operation_orders WHERE created_at >= ?`).bind(since).first<Record<string, number>>(),
    count(database, "SELECT COUNT(*) AS count FROM stream_connections WHERE expires_at > ?", [new Date().toISOString()]),
  ]);
  const durations = requestRows.map((row) => Number(row.durationMs)).sort((left, right) => left - right);
  const requestCount = requestRows.length;
  const errorCount = requestRows.filter((row) => Number(row.statusCode) >= 500).length;
  const requests = {
    requestCount,
    requestsPerMinute: requestCount / 60,
    errorCount,
    errorRate: requestCount ? errorCount / requestCount : 0,
    averageMs: requestCount ? durations.reduce((sum, value) => sum + value, 0) / requestCount : 0,
    p95Ms: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] || 0,
    maximumMs: durations.at(-1) || 0,
  };
  return { since, incidents, requests, operations, activeStreamConnections: connections };
}
