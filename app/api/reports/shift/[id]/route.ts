import { requireRuntimeDatabase } from "../../../../../db/runtime-database";
import { OperationsError } from "../../../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../../../lib/portal-session";
import { queryRows } from "../../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function money(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printable(report: Record<string, unknown>) {
  const orders = report.orders as Array<Record<string, unknown>>;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Báo cáo ca</title><style>body{font:13px system-ui;margin:0 auto;padding:12px;max-width:360px;color:#181512}h1{font-size:18px}dl{display:grid;grid-template-columns:1fr auto;gap:5px;margin:12px 0}dt,dd{margin:0}table{border-collapse:collapse;width:100%;font-size:11px}td,th{padding:5px 2px;border-bottom:1px dashed #aaa;text-align:left}td:last-child,th:last-child{text-align:right}@media print{body{padding:0}}</style></head><body><h1>Tào Phớ 88 · Báo cáo cuối ca</h1><p>${escapeHtml(report.siteName)}<br>${escapeHtml(report.openedAt)} → ${escapeHtml(report.closedAt || "Đang mở")}</p><dl><dt>Số bill</dt><dd>${report.billCount}</dd><dt>Doanh thu</dt><dd>${money(Number(report.revenue))}</dd><dt>Tiền mặt</dt><dd>${money(Number(report.cashRevenue))}</dd><dt>VietQR</dt><dd>${money(Number(report.qrRevenue))}</dd><dt>Tiền kỳ vọng</dt><dd>${money(Number(report.expectedCash))}</dd><dt>Đã đếm</dt><dd>${money(Number(report.countedCash))}</dd><dt>Chênh lệch</dt><dd>${money(Number(report.variance))}</dd></dl><table><thead><tr><th>Đơn</th><th>PT</th><th>Tiền</th></tr></thead><tbody>${orders.map((order) => `<tr><td>${escapeHtml(order.orderCode)}</td><td>${order.paymentMethod === "cash" ? "Mặt" : "QR"}</td><td>${money(Number(order.totalAmount))}</td></tr>`).join("")}</tbody></table><script>window.addEventListener('load',()=>window.print())</script></body></html>`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!portalSessionConfigReady()) throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem báo cáo ca.", 401, "portal_session_required");
    const { id } = await context.params;
    const database = await requireRuntimeDatabase();
    const shift = (await queryRows<Record<string, unknown>>(database.prepare(`SELECT s.*, p.name AS site_name
      FROM work_shifts s JOIN operation_sites p ON p.id = s.site_id WHERE s.id = ? LIMIT 1`).bind(id)))[0];
    if (!shift) throw new OperationsError("Không tìm thấy ca làm việc.", 404, "shift_not_found");
    const siteId = String(shift.siteId);
    if (!session.scope.isGlobal && !session.scope.siteIds.includes(siteId)) throw new OperationsError("Ca không thuộc phạm vi được giao.", 403, "forbidden_scope");
    const [orders, movements, refunds] = await Promise.all([
      queryRows<Record<string, unknown>>(database.prepare(`SELECT id, order_code, payment_method, payment_status, total_amount, customer_name, completed_at
        FROM operation_orders WHERE shift_id = ? ORDER BY completed_at, created_at`).bind(id)),
      queryRows<Record<string, unknown>>(database.prepare(`SELECT movement_type, COUNT(*) AS movement_count, COALESCE(SUM(amount), 0) AS amount
        FROM cash_movements WHERE shift_id = ? GROUP BY movement_type ORDER BY movement_type`).bind(id)),
      queryRows<{ total: number }>(database.prepare(`SELECT COALESCE(SUM(r.amount), 0) AS total FROM payment_refunds r
        JOIN operation_orders o ON o.id = r.order_id WHERE o.shift_id = ? AND r.status = 'completed'`).bind(id)),
    ]);
    const cashRevenue = orders.filter((order) => order.paymentMethod === "cash").reduce((sum, order) => sum + Number(order.totalAmount), 0);
    const qrRevenue = orders.filter((order) => order.paymentMethod === "bank_transfer").reduce((sum, order) => sum + Number(order.totalAmount), 0);
    const report = {
      shiftId: id,
      siteId,
      siteName: shift.siteName,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      status: shift.status,
      billCount: orders.length,
      revenue: cashRevenue + qrRevenue,
      cashRevenue,
      qrRevenue,
      refunds: Number(refunds[0]?.total || 0),
      openingCash: Number(shift.openingCash || 0),
      expectedCash: Number(shift.expectedCash || 0),
      countedCash: Number(shift.countedCash || 0),
      variance: Number(shift.variance || 0),
      movements,
      orders,
    };
    const url = new URL(request.url);
    if (url.searchParams.get("format") === "print" || request.headers.get("accept")?.includes("text/html")) {
      return new Response(printable(report), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return Response.json({ ok: true, report }, { headers: { "cache-control": "no-store", vary: "Cookie" } });
  } catch (error) {
    if (error instanceof OperationsError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    console.error("Không thể tạo báo cáo ca.", error);
    return Response.json({ ok: false, error: "Không thể tạo báo cáo ca.", code: "shift_report_failed" }, { status: 500 });
  }
}
