import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../../lib/portal-api";
import { getScopedOrder } from "../../../../lib/scoped-operations";
import { recordPiiAccess } from "../../../../lib/privacy";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  try {
    const { database, session, policy } = await requirePortalApiContext(request);
    const { id } = await context.params;
    const orderId = decodeURIComponent(id || "").trim();
    if (!orderId || orderId.length > 160) return portalApiJson({ ok: false, error: "Mã đơn không hợp lệ.", code: "invalid_order_id" }, { status: 400 });
    const order = await getScopedOrder(database, session, orderId);
    if (policy.canReadCustomerPii) await recordPiiAccess(database, request, session, { accessType: "detail", entityType: "order", entityId: orderId, rowCount: 1 });
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, order });
  } catch (error) {
    return portalApiError(error, "order_failed", "Không thể tải chi tiết đơn hàng.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
