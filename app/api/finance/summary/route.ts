import { recordApplicationRequest, requirePortalApiContext, portalApiError, portalApiJson } from "../../../../lib/portal-api";
import { getScopedFinanceSummary } from "../../../../lib/scoped-operations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  try {
    const { database, session } = await requirePortalApiContext(request, "finance.read");
    const search = new URL(request.url).searchParams;
    const summary = await getScopedFinanceSummary(
      database,
      session,
      search.get("period")?.trim() || undefined,
      search.get("siteId")?.trim() || undefined,
    );
    await recordApplicationRequest(database, request, startedAt, 200, session.userId);
    return portalApiJson({ ok: true, summary });
  } catch (error) {
    return portalApiError(error, "finance_summary_failed", "Không thể tổng hợp tài chính.");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
