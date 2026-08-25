import { requireRuntimeDatabase } from "../../../db/runtime-database";
import { orderTraceability } from "../../../lib/finance-reports";
import { ensureOperationsSchema } from "../../../lib/operations-schema";
import { OperationsError } from "../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../lib/portal-session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!portalSessionConfigReady()) throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để truy xuất nguồn gốc.", 401, "portal_session_required");
    const orderId = new URL(request.url).searchParams.get("orderId")?.trim() || "";
    if (!orderId) throw new OperationsError("Thiếu orderId hoặc mã đơn hàng.", 400, "order_id_required");
    const database = await requireRuntimeDatabase();
    await ensureOperationsSchema(database);
    return Response.json(await orderTraceability(database, session, orderId), { headers: { "cache-control": "no-store", vary: "Cookie" } });
  } catch (error) {
    if (error instanceof OperationsError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    console.error("Không thể truy xuất nguồn gốc.", error);
    return Response.json({ ok: false, error: "Không thể truy xuất nguồn gốc.", code: "traceability_failed" }, { status: 500 });
  }
}
