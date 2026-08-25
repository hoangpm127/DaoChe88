import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../lib/portal-api";
import { listScopedAlerts } from "../../../lib/scoped-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request);
    const search = new URL(request.url).searchParams;
    const result = await listScopedAlerts(database, session, {
      status: search.get("status")?.trim() || undefined,
      cursor: search.get("cursor") || undefined,
      limit: Number(search.get("limit")) || undefined,
    });
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, ...result });
  } catch (error) {
    return portalApiError(error, "alerts_failed", "Không thể tải danh sách cảnh báo.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
