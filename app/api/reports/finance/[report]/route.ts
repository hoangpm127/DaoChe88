import { requireRuntimeDatabase } from "../../../../../db/runtime-database";
import { buildFinanceReport, reportCsv } from "../../../../../lib/finance-reports";
import { ensureOperationsSchema } from "../../../../../lib/operations-schema";
import { OperationsError } from "../../../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../../../lib/portal-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ report: string }> }) {
  try {
    if (!portalSessionConfigReady()) throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem báo cáo.", 401, "portal_session_required");
    const database = await requireRuntimeDatabase();
    await ensureOperationsSchema(database);
    const { report: name } = await context.params;
    const url = new URL(request.url);
    const report = await buildFinanceReport(database, session, name, url);
    if (url.searchParams.get("format") === "csv") {
      return new Response(reportCsv(report), { headers: { "cache-control": "no-store", "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, vary: "Cookie" } });
    }
    return Response.json({ ok: true, ...report }, { headers: { "cache-control": "no-store", vary: "Cookie" } });
  } catch (error) {
    if (error instanceof OperationsError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    console.error("Không thể tạo báo cáo tài chính.", error);
    return Response.json({ ok: false, error: "Không thể tạo báo cáo tài chính.", code: "finance_report_failed" }, { status: 500 });
  }
}
