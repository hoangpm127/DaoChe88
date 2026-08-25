/**
 * Danh sách ca gần đây, để portal có chỗ bấm in báo cáo chốt ca (M8).
 *
 * Báo cáo in nằm ở /api/reports/shift/[id] và đã có từ trước, nhưng không có
 * đường nào lấy được mã ca nên không màn hình nào gắn được nút in. Đây là mắt
 * xích còn thiếu.
 *
 * Lọc theo phạm vi điểm bán của phiên ngay trong SQL, cùng cách mọi API vận hành
 * khác đang làm.
 */

import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../../lib/portal-api";
import { queryRows } from "../../../../lib/operations-sql";
import { resolvePortalPolicy } from "../../../../lib/portal-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request);
    const policy = resolvePortalPolicy(session.role, session.scope);
    const search = new URL(request.url).searchParams;
    const siteId = search.get("siteId")?.trim() || "";

    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (policy.locationVisibility === "none") {
      clauses.push("1 = 0");
    } else if (policy.locationVisibility !== "all") {
      // Không có điểm nào trong phạm vi thì chặn hẳn, đừng để mệnh đề IN rỗng
      // biến thành "xem được tất cả".
      if (!policy.siteIds.length) clauses.push("1 = 0");
      else {
        clauses.push(`s.site_id IN (${policy.siteIds.map(() => "?").join(", ")})`);
        values.push(...policy.siteIds);
      }
    }
    if (siteId) {
      clauses.push("s.site_id = ?");
      values.push(siteId);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    const data = await queryRows(
      database.prepare(`SELECT s.id, s.site_id, p.name AS site_name, s.opened_at, s.closed_at,
          s.opening_cash, s.counted_cash, s.expected_cash, s.variance, s.status
        FROM work_shifts s JOIN operation_sites p ON p.id = s.site_id${where}
        ORDER BY s.opened_at DESC LIMIT 30`).bind(...values),
    );

    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, data });
  } catch (error) {
    return portalApiError(error, "shifts_failed", "Không thể tải danh sách ca.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
