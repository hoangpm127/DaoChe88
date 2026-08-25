import { requireRuntimeDatabase, type RuntimeDatabase } from "../db/runtime-database.ts";
import { OperationsError } from "./operations-error.ts";
import {
  portalRoleCan,
  resolvePortalPolicy,
  type PortalCapability,
  type PortalRolePolicy,
} from "./portal-access.ts";
import { portalSessionConfigReady, readPortalSession, type PortalSession } from "./portal-session.ts";

export type PortalApiContext = {
  database: RuntimeDatabase;
  session: PortalSession;
  policy: PortalRolePolicy;
};

export async function requirePortalApiContext(
  request: Request,
  capability: PortalCapability = "snapshot.read",
): Promise<PortalApiContext> {
  if (!portalSessionConfigReady()) {
    throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
  }
  const session = await readPortalSession(request);
  if (!session) {
    throw new OperationsError("Cần đăng nhập portal để xem dữ liệu.", 401, "portal_session_required");
  }
  if (!portalRoleCan(session.role, capability)) {
    throw new OperationsError("Vai trò hiện tại không có quyền truy cập dữ liệu này.", 403, "forbidden_capability");
  }
  return {
    database: await requireRuntimeDatabase(),
    session,
    policy: resolvePortalPolicy(session.role, session.scope),
  };
}

export function portalApiJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", "Cookie");
  return Response.json(body, { ...init, headers });
}

export async function recordApplicationRequest(
  database: RuntimeDatabase,
  request: Request,
  startedAt: number,
  statusCode: number,
  userId?: string,
) {
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id")?.trim().slice(0, 100) || crypto.randomUUID();
  await database.prepare(`INSERT INTO application_request_log
    (id, request_id, route, method, status_code, duration_ms, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), requestId, url.pathname.slice(0, 240), request.method, statusCode, Math.max(0, Math.round(performance.now() - startedAt)), userId || null, new Date().toISOString())
    .run();
}

export function portalApiError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof OperationsError) {
    return portalApiJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  console.error(fallbackMessage, error);
  return portalApiJson({ ok: false, error: fallbackMessage, code: fallbackCode }, { status: 500 });
}
