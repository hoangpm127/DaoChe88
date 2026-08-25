import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { OperationsError } from "../../../../lib/operations-types";
import { readPortalSession } from "../../../../lib/portal-session";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0", vary: "Cookie" } });
}

export async function GET(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem bảng phí.", 401, "portal_session_required");
    if (!session.scope.isGlobal && !["store-owner", "manager", "store-staff", "store"].includes(session.role)) throw new OperationsError("Vai trò này không được xem bảng phí giao.", 403, "forbidden_role");
    const database = await requireRuntimeDatabase();
    const rows = await queryRows<Record<string, unknown>>(database.prepare(`SELECT r.*, s.name AS site_name,
      CASE WHEN r.effective_to IS NULL OR r.effective_to > ? THEN 'active' ELSE 'archived' END AS status
      FROM delivery_fee_rules r LEFT JOIN operation_sites s ON s.id = r.site_id
      ORDER BY status, r.priority DESC, r.site_id, r.min_value`).bind(new Date().toISOString()));
    const rules = session.scope.isGlobal ? rows : rows.filter((rule) => !rule.siteId || session.scope.siteIds.includes(String(rule.siteId)));
    return json({ ok: true, rules });
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể tải bảng phí giao.", error);
    return json({ ok: false, error: "Không thể tải bảng phí giao.", code: "delivery_rules_read_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
