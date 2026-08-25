import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../../lib/portal-api";
import { listScopedFinanceLedger } from "../../../../lib/scoped-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request, "finance.read");
    const search = new URL(request.url).searchParams;
    const result = await listScopedFinanceLedger(database, session, {
      siteId: search.get("siteId")?.trim() || undefined,
      from: search.get("from") || undefined,
      to: search.get("to") || undefined,
      cursor: search.get("cursor") || undefined,
      limit: Number(search.get("limit")) || undefined,
    });
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, ...result });
  } catch (error) {
    return portalApiError(error, "finance_ledger_failed", "Không thể tải sổ tài chính.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
