import { OperationsError } from "../../../../lib/operations-error";
import { requirePortalApiContext, portalApiError, portalApiJson } from "../../../../lib/portal-api";
import { monitoringSummary } from "../../../../lib/runtime-monitoring";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { database, session } = await requirePortalApiContext(request, "operations.audit.read");
    if (!["owner", "super-admin", "control"].includes(session.role)) {
      throw new OperationsError("Vai trò hiện tại không được xem giám sát hệ thống.", 403, "forbidden_capability");
    }
    return portalApiJson({ ok: true, summary: await monitoringSummary(database) });
  } catch (error) {
    return portalApiError(error, "monitoring_summary_failed", "Không thể tải bảng giám sát.");
  }
}
