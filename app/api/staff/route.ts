import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../lib/portal-api";
import { listScopedStaff } from "../../../lib/scoped-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request);
    const siteId = new URL(request.url).searchParams.get("siteId")?.trim() || undefined;
    const data = await listScopedStaff(database, session, siteId);
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, data });
  } catch (error) {
    return portalApiError(error, "staff_failed", "Không thể tải nhân sự.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
