import { getRuntimeDatabase } from "../../../../db/runtime-database";
import { ensureOperationsSchema } from "../../../../lib/operations-schema";
import { OperationsError } from "../../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../../lib/portal-session";
import { settingHistory } from "../../../../lib/settings-store";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      vary: "Cookie",
    },
  });
}

export async function GET(request: Request) {
  try {
    if (!portalSessionConfigReady()) return noStoreJson({ ok: false, error: "Portal chưa được cấu hình khóa phiên.", code: "portal_session_not_configured" }, 503);
    const session = await readPortalSession(request);
    if (!session) return noStoreJson({ ok: false, error: "Cần đăng nhập portal để xem lịch sử cấu hình.", code: "portal_session_required" }, 401);
    const url = new URL(request.url);
    const key = (url.searchParams.get("key") || "").trim();
    if (!key) throw new OperationsError("Thiếu khóa thông số cần xem lịch sử.", 400, "missing_setting_key");
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100;
    const database = await getRuntimeDatabase();
    if (!database) return noStoreJson({ ok: false, error: "Database chưa được cấu hình.", code: "database_not_configured" }, 503);
    await ensureOperationsSchema(database);
    const history = await settingHistory(database, {
      role: session.role,
      name: session.fullName,
      userId: session.userId,
      scope: session.scope,
    }, key, limit);
    return noStoreJson({ ok: true, key, history });
  } catch (error) {
    if (error instanceof OperationsError) return noStoreJson({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể tải lịch sử cấu hình.", error);
    return noStoreJson({ ok: false, error: "Không thể tải lịch sử cấu hình.", code: "setting_history_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
