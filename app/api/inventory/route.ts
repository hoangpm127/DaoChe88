import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../lib/portal-api";
import { listScopedInventory } from "../../../lib/scoped-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request);
    const siteId = new URL(request.url).searchParams.get("siteId")?.trim() || undefined;
    const data = await listScopedInventory(database, session, siteId);
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, data });
  } catch (error) {
    return portalApiError(error, "inventory_failed", "Không thể tải tồn kho.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
