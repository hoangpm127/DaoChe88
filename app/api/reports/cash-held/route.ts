import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { OperationsError } from "../../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../../lib/portal-session";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!portalSessionConfigReady()) throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem tiền COD.", 401, "portal_session_required");
    const database = await requireRuntimeDatabase();
    const rows = await queryRows<Record<string, unknown>>(database.prepare(`SELECT c.actor_user_id, c.site_id, s.name AS site_name,
      COALESCE(u.full_name, st.name, c.actor_user_id) AS holder_name, COUNT(*) AS movement_count, SUM(c.amount) AS amount
      FROM cash_movements c
      LEFT JOIN users u ON u.id = c.actor_user_id
      LEFT JOIN operation_staff st ON st.user_id = c.actor_user_id
      JOIN operation_sites s ON s.id = c.site_id
      WHERE c.movement_type = 'sale' AND c.shift_id IS NULL AND c.remitted_at IS NULL
      GROUP BY c.actor_user_id, c.site_id, s.name, u.full_name, st.name ORDER BY amount DESC`));
    const visible = rows.filter((row) => session.scope.isGlobal
      || (session.role === "shipper" && row.actorUserId === session.userId)
      || session.scope.siteIds.includes(String(row.siteId)));
    return Response.json({ ok: true, totalHeld: visible.reduce((sum, row) => sum + Number(row.amount), 0), holders: visible }, { headers: { "cache-control": "no-store", vary: "Cookie" } });
  } catch (error) {
    if (error instanceof OperationsError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    console.error("Không thể tải báo cáo COD.", error);
    return Response.json({ ok: false, error: "Không thể tải báo cáo COD.", code: "cash_held_report_failed" }, { status: 500 });
  }
}
