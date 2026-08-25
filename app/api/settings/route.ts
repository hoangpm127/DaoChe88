import { getRuntimeDatabase } from "../../../db/runtime-database";
import { ensureOperationsSchema } from "../../../lib/operations-schema";
import { OperationsError } from "../../../lib/operations-types";
import { portalSessionConfigReady, readPortalSession } from "../../../lib/portal-session";
import { listSettingsForActor } from "../../../lib/settings-store";

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
    if (!session) return noStoreJson({ ok: false, error: "Cần đăng nhập portal để xem cấu hình.", code: "portal_session_required" }, 401);
    const database = await getRuntimeDatabase();
    if (!database) return noStoreJson({ ok: false, error: "Database chưa được cấu hình.", code: "database_not_configured" }, 503);
    await ensureOperationsSchema(database);
    return noStoreJson({ ok: true, ...await listSettingsForActor(database, {
      role: session.role,
      name: session.fullName,
      userId: session.userId,
      scope: session.scope,
    }) });
  } catch (error) {
    if (error instanceof OperationsError) return noStoreJson({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể tải cấu hình hệ thống.", error);
    return noStoreJson({ ok: false, error: "Không thể tải cấu hình hệ thống.", code: "settings_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
