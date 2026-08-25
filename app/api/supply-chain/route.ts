import { requireRuntimeDatabase } from "../../../db/runtime-database";
import { supplyChainDashboard } from "../../../lib/finance-reports";
import { ensureOperationsSchema } from "../../../lib/operations-schema";
import { OperationsError } from "../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../lib/portal-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!portalSessionConfigReady()) throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem chuỗi cung ứng.", 401, "portal_session_required");
    const database = await requireRuntimeDatabase();
    await ensureOperationsSchema(database);
    return Response.json(await supplyChainDashboard(database, session, new URL(request.url)), { headers: { "cache-control": "no-store", vary: "Cookie" } });
  } catch (error) {
    if (error instanceof OperationsError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    console.error("Không thể tải chuỗi cung ứng.", error);
    return Response.json({ ok: false, error: "Không thể tải chuỗi cung ứng.", code: "supply_chain_failed" }, { status: 500 });
  }
}
