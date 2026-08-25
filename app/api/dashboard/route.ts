/**
 * Các con số tổng cho bảng điều khiển portal.
 *
 * Portal từng lấy những số này bằng cách gọi /api/operations rồi đếm ở trình
 * duyệt — kéo toàn bộ bảng đối tác, nhật ký sự kiện, sổ cái và chi phí về chỉ để
 * hiện ra vài ô thống kê. Endpoint này đếm và cộng ngay trong SQL, có lọc theo
 * phạm vi quyền của phiên.
 */

import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../lib/portal-api";
import { getScopedDashboard } from "../../../lib/scoped-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request);
    const data = await getScopedDashboard(database, session);
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, data });
  } catch (error) {
    return portalApiError(error, "dashboard_failed", "Không thể tải số liệu tổng quan.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
