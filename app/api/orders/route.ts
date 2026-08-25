import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../lib/portal-api";
import { listScopedOrders } from "../../../lib/scoped-operations";
import { recordPiiAccess } from "../../../lib/privacy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session, policy } = await requirePortalApiContext(request);
    const search = new URL(request.url).searchParams;
    const result = await listScopedOrders(database, session, {
      siteId: search.get("siteId")?.trim() || undefined,
      status: search.get("status")?.trim() || undefined,
      from: search.get("from") || undefined,
      to: search.get("to") || undefined,
      cursor: search.get("cursor") || undefined,
      limit: Number(search.get("limit")) || undefined,
    });
    if (policy.canReadCustomerPii) await recordPiiAccess(database, request, session, {
      accessType: "list",
      entityType: "order",
      filters: { siteId: search.get("siteId") || "", status: search.get("status") || "", from: search.get("from") || "", to: search.get("to") || "" },
      rowCount: result.data.length,
    });
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, ...result });
  } catch (error) {
    return portalApiError(error, "orders_failed", "Không thể tải danh sách đơn hàng.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
