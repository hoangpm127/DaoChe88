import { requirePortalApiContext, portalApiError, portalApiJson } from "../../../../../../lib/portal-api";
import { anonymizeCustomer } from "../../../../../../lib/privacy";
import { OperationsError } from "../../../../../../lib/operations-error";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { database, session } = await requirePortalApiContext(request, "customer-pii.read");
    if (!["owner", "super-admin"].includes(session.role)) {
      throw new OperationsError("Chỉ Admin tổng được xác nhận ẩn danh hóa khách hàng.", 403, "forbidden_capability");
    }
    const { id } = await context.params;
    const customerId = decodeURIComponent(id || "").trim();
    if (!customerId || customerId.length > 160) throw new OperationsError("Mã khách hàng không hợp lệ.", 400, "invalid_customer_id");
    const result = await anonymizeCustomer(database, customerId, session, request.headers.get("x-request-id") || "");
    return portalApiJson({ ok: true, result });
  } catch (error) {
    return portalApiError(error, "customer_anonymize_failed", "Không thể ẩn danh hóa khách hàng.");
  }
}
